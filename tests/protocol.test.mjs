import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { buildSite } from "../lib/site.mjs";
import { buildAddressManifest, packUrl, packShard, packMetadata, regionRevision } from "../lib/runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/policy.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
const load = name => ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", name + ".schema.json"), "utf8")));
const schemas = Object.fromEntries(["member", "review", "ledger-event", "ledger-operation", "allocation", "publication", "catalog", "region", "pack-metadata", "entry", "address-manifest"].map(name => [name, load(name)]));
const check = (name, value) => assert(schemas[name](value), name + " rejected a valid record: " + JSON.stringify(schemas[name].errors));
const reject = (name, value) => assert(!schemas[name](value), name + " accepted an invalid record");

const member = () => ({ schema_version: 1, github_id: 11071219, login: "Ero-Cat", credits: 1, initial_grant: true });
const review = () => ({
  schema_version: 1, review_id: "RV-000001", submission_issue_number: 9,
  reviewed_revision: "a".repeat(64), reviewer: { github_id: 42, login: "reviewer" },
  position: "support", statement: "同意,依据充分。", conflict_of_interest: false,
  independent_confirmation: { confirmed_by: 11071219, confirmed_at: "2026-10-07T00:00:00.000Z" },
  rewarded: false, submitted_at: "2026-10-07T00:00:00.000Z"
});
const publishOperation = () => ({
  operation_id: "publish:9:" + "a".repeat(64), policy_version: "pilot-v1", issue_number: 9, approved_by: 11071219,
  events: [{ operation_id: "publish:9:" + "a".repeat(64), kind: "initial-grant", member_id: 123456, amount: 1, entry_id: null, review_id: null, timestamp: "2026-10-07T00:00:00.000Z" }]
});
const visibilityOperation = () => ({ operation_id: "visibility:42", entry_id: "CC-000001", status: "hidden", approved_by: 11071219, timestamp: "2026-10-07T00:00:00.000Z" });
const allocation = () => ({ schema_version: 1, allocation_id: "AL-000001", member_id: 42, amount: 1, reason: "review-exchange", evidence: ["RV-000001", "RV-000002", "RV-000003"], granted_at: "2026-10-07T00:00:00.000Z", operation_id: "exchange:42:1" });
const publication = () => ({
  schema_version: 1, publication_id: "PB-000001", publication_sequence: 1, source_sha: "0".repeat(40),
  protocol_version: 1, layout_version: "cemetery-v1", status: "activated",
  archives: [{ repository: "vrchat-cyber-cemetery/world-data-0", role: "shard-0", url: "https://vrchat-cyber-cemetery.github.io/world-data-0/archives/1.zip", sha256: "b".repeat(64), bytes: 1024 }],
  requested_by: 11071219, requested_at: "2026-10-07T00:00:00.000Z", activated_at: "2026-10-07T01:00:00.000Z"
});

test("member schema accepts numeric identity with optional VRChat binding", () => {
  check("member", member());
  check("member", { ...member(), vrchat_user_id: "usr_0123-abcd", registered_at: "2026-10-07T00:00:00.000Z" });
  reject("member", { ...member(), credits: -1 });
  reject("member", { ...member(), extra: true });
});
test("review schema binds opinions to one submission revision", () => {
  check("review", review());
  check("review", { ...review(), position: "reject", independent_confirmation: null, rewarded: false });
  reject("review", { ...review(), position: "approve" });
  reject("review", { ...review(), reviewed_revision: "short" });
});
test("ledger event rows must carry a non-zero amount", () => {
  check("ledger-event", publishOperation().events[0]);
  check("ledger-event", { ...publishOperation().events[0], kind: "review-exchange", amount: 1, review_id: "RV-000001" });
  reject("ledger-event", { ...publishOperation().events[0], amount: 0 });
  reject("ledger-event", { ...publishOperation().events[0], kind: "gift" });
});
test("ledger operation envelopes match the shapes actually written", () => {
  check("ledger-operation", publishOperation());
  check("ledger-operation", visibilityOperation());
  reject("ledger-operation", { ...visibilityOperation(), status: "erased" });
  reject("ledger-operation", { operation_id: "x", unknown: true });
});
test("allocation records explain why credits exist", () => {
  check("allocation", allocation());
  check("allocation", { ...allocation(), reason: "compensation", evidence: [] });
  reject("allocation", { ...allocation(), amount: 0 });
  reject("allocation", { ...allocation(), allocation_id: "XX-000001" });
});
test("publication records pin source commit and archive hashes", () => {
  check("publication", publication());
  reject("publication", { ...publication(), source_sha: "HEAD" });
  reject("publication", { ...publication(), archives: [{ repository: "x", role: "main", url: "http://insecure", sha256: "b".repeat(64), bytes: 1 }] });
  reject("publication", { ...publication(), publication_sequence: 0 });
});
test("generated catalog and region exports satisfy runtime schemas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-runtime-"));
  try {
    const state = { publication_sequence: 0, entries: {} };
    buildSite(root, dir, project, policy, state, []);
    check("catalog", JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8")));
    for (const region of ["00", "31", "63"]) {
      const value = JSON.parse(fs.readFileSync(path.join(dir, "regions", region + ".json"), "utf8"));
      check("region", value);
      assert.equal(value.groups.length, 8);
      value.groups.forEach((group, index) => assert.equal(group.pack, value.region * 8 + index));
    }
    const first = JSON.parse(fs.readFileSync(path.join(dir, "regions", "00.json"), "utf8"));
    const last = JSON.parse(fs.readFileSync(path.join(dir, "regions", "63.json"), "utf8"));
    assert.equal(first.groups[0].url, project.data_site_bases[0] + "/packs/000.bin");
    assert.equal(last.groups[7].url, project.data_site_bases[1] + "/packs/511.bin");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("pack metadata keeps unpublished positions null and pins slot order", () => {
  const empty = { schema: 1, community_id: project.community_id, layout_version: project.layout_version, region: 12, group: 4, revision: "empty-v1", entries: Array.from({ length: 8 }, () => null) };
  check("pack-metadata", empty);
  const filled = structuredClone(empty);
  filled.entries[3] = {
    id: "CC-000123", slot: 3, revision: "c".repeat(64), title: "标题", buried_type: "memory",
    buried_subject: "一段记忆", epitaph: "", story: "", date_note: "",
    images: { main: false, memorial: [false, false, false], avatars: [false, false, false] }
  };
  check("pack-metadata", filled);
  const misplaced = structuredClone(filled);
  misplaced.entries[3].slot = 4;
  reject("pack-metadata", misplaced);
  const shortList = structuredClone(empty);
  shortList.entries.pop();
  reject("pack-metadata", shortList);
});
test("address manifest exposes exactly 577 unique fixed URLs split across shards", () => {
  const manifest = buildAddressManifest(project);
  check("address-manifest", manifest);
  reject("address-manifest", { ...manifest, packs: manifest.packs.slice(0, 511) });
  reject("address-manifest", { ...manifest, catalog: "https://example.com/other.json" });
  assert.equal(manifest.counts.total, 577);
  assert.equal(new Set([manifest.catalog, ...manifest.regions, ...manifest.packs]).size, 577);
  assert.equal(manifest.regions[0], project.site_base + "/regions/00.json");
  assert.equal(packShard(project, 0), 0);
  assert.equal(packShard(project, 255), 0);
  assert.equal(packShard(project, 256), 1);
  assert.equal(packUrl(project, 256), project.data_site_bases[1] + "/packs/256.bin");
  assert.throws(() => packUrl(project, 512), /capacity/);
});
test("published site configuration derives from approved policy and project config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-config-"));
  try {
    buildSite(root, dir, project, policy, { publication_sequence: 0, entries: {} }, []);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "assets/site-config.json"), "utf8"));
    assert.equal(config.member_credits, policy.initial_creation_credits);
    assert.equal(config.review_exchange, policy.valid_reviews_per_credit);
    assert.deepEqual(config.data_site_bases, project.data_site_bases);
    assert.equal(config.protocol_version, project.protocol_version);
    assert.equal(config.layout_version, project.layout_version);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("region summaries advertise the exact revision of each pack", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-regions-"));
  try {
    const published = [{
      id: "CC-000001", status: "published", title: "标题", buried_type: "memory", buried_subject: "对象",
      epitaph: "", story: "", date_note: "", tags: [], links: [], players: [],
      images: { main: null, memorial: [], avatars: [] },
      slot: 737, locator: "12-34", approved_revision: "d".repeat(64),
      updated_at: "2026-10-07T00:00:00.000Z", publication_sequence: 1
    }];
    buildSite(root, dir, project, policy, { publication_sequence: 1, entries: { "CC-000001": { id: "CC-000001", slot: 737, status: "published" } } }, published);
    // slot 737 renders as human region 12 but lives in internal region index 11
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "regions", "11.json"), "utf8"));
    assert.equal(summary.region, 11);
    assert.equal(summary.entries.length, 1);
    assert.equal(summary.entries[0].slot, 33);
    summary.groups.forEach((group, index) => {
      const meta = packMetadata(project, published, 11, index);
      assert.equal(group.revision, meta.revision);
      assert.equal(group.pack, 11 * 8 + index);
      assert.equal(group.url, packUrl(project, 11 * 8 + index));
      if (index === 4) assert.equal(meta.entries[1].id, "CC-000001");
      else assert.equal(meta.revision, "empty-v1");
    });
    assert.notEqual(summary.revision, "empty-v1");
    assert.equal(summary.revision, regionRevision(published, summary.groups.map(g => g.revision)));
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8"));
    assert.equal(catalog.regions[11].published_count, 1);
    assert.equal(catalog.regions[11].revision, summary.revision);
    assert.equal(catalog.regions[10].revision, "empty-v1");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("publication primitives: atlas layout, DDS parsing, pack encoding and budgets", async () => {
  const { atlasCells, bc1BlocksFromDDS, encodePack, checkBudgets, publicationRecord, TEXCONV, CCPACK } = await import("../lib/publication.mjs");
  for (let strip = 0; strip < 8; strip++) {
    const cells = atlasCells(strip);
    assert.equal(cells.length, 7);
    for (const cell of cells) {
      assert(cell.x >= 0 && cell.y >= 0 && cell.x + cell.size <= 2048 && cell.y + cell.size <= 2048);
      for (const other of cells) if (other !== cell)
        assert(cell.x + cell.size <= other.x || other.x + other.size <= cell.x || cell.y + cell.size <= other.y || other.y + other.size <= cell.y, "cells must not overlap");
    }
  }
  const synthetic = Buffer.alloc(128 + CCPACK.textureBytes);
  synthetic.write("DDS ", 0, "ascii");
  synthetic.writeUInt32LE(2048, 12); synthetic.writeUInt32LE(2048, 16);
  synthetic.writeUInt32LE(1, 28);
  synthetic.write("DXT1", 84, "ascii");
  const blocks = bc1BlocksFromDDS(synthetic);
  assert.equal(blocks.length, CCPACK.textureBytes);
  const damaged = Buffer.from(synthetic); damaged.writeUInt32LE(1024, 16);
  assert.throws(() => bc1BlocksFromDDS(damaged), /2048/);
  const wrongMips = Buffer.from(synthetic); wrongMips.writeUInt32LE(2, 28);
  assert.throws(() => bc1BlocksFromDDS(wrongMips), /mip/);
  const wrongFourCC = Buffer.from(synthetic); wrongFourCC.write("BC3", 84, "ascii");
  assert.throws(() => bc1BlocksFromDDS(wrongFourCC), /DXT1/);
  assert.throws(() => bc1BlocksFromDDS(synthetic.subarray(0, -1)), /长度不符/);

  const meta = { schema: 1, community_id: project.community_id, layout_version: project.layout_version, region: 0, group: 0, revision: "empty-v1", entries: Array.from({ length: 8 }, () => null) };
  const pack = encodePack(meta, blocks);
  assert.equal(pack.length, CCPACK.header + Buffer.byteLength(JSON.stringify(meta)) + CCPACK.textureBytes);
  assert.equal(pack.subarray(0, 8).toString("ascii"), "CCPACK01");
  assert.equal(pack.readUInt32LE(12), CCPACK.textureBytes);
  assert.equal(pack[20], 1);
  assert.throws(() => encodePack(meta, Buffer.alloc(8)), /2MiB/);
  const oversized = { ...meta, revision: "huge", entries: Array.from({ length: 8 }, () => ({ id: "CC-000001", slot: 0, revision: "a".repeat(64), title: "x".repeat(240), buried_type: "other", buried_subject: "y".repeat(240), epitaph: "z".repeat(500), story: "s".repeat(4000), date_note: "d".repeat(12000), images: { main: false, memorial: [false, false, false], avatars: [false, false, false] } })) };
  assert.throws(() => encodePack(oversized, blocks), /协议范围/);

  assert.throws(() => checkBudgets(project, { "world-data-0": 2228256 * 256 + 1 }, 0), /上限/);
  checkBudgets(project, { "world-data-0": 2228256 * 256, "world-data-1": 0 }, 734003200);

  const record = publicationRecord({ publication_id: "PB-000001", sequence: 1, source_sha: "0".repeat(40), project, archives: [{ repository: "o/r", role: "shard-0", url: "https://example.com/a.zip", sha256: "b".repeat(64), bytes: 10 }], requested_by: 1, requested_at: "2026-10-07T00:00:00.000Z" });
  check("publication", record);
  assert.throws(() => publicationRecord({ publication_id: "PB-000001", sequence: 0, source_sha: "0".repeat(40), project, archives: [], requested_by: 1, requested_at: "x" }), /单调/);
  assert.equal(TEXCONV.version, "may2026");
  assert.match(TEXCONV.sha256, /^[0-9a-f]{64}$/);
});
