import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { buildSite } from "../lib/site.mjs";
import { buildAddressManifest, packUrl, packShard } from "../lib/runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
const load = name => ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", name + ".schema.json"), "utf8")));
const schemas = Object.fromEntries(["member", "review", "ledger-event", "ledger-operation", "allocation", "publication", "catalog", "region", "pack-metadata", "entry"].map(name => [name, load(name)]));
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
    buildSite(root, dir, project, state, []);
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
  assert.equal(manifest.counts.total, 577);
  assert.equal(new Set([manifest.catalog, ...manifest.regions, ...manifest.packs]).size, 577);
  assert.equal(manifest.regions[0], project.site_base + "/regions/00.json");
  assert.equal(packShard(project, 0), 0);
  assert.equal(packShard(project, 255), 0);
  assert.equal(packShard(project, 256), 1);
  assert.equal(packUrl(project, 256), project.data_site_bases[1] + "/packs/256.bin");
  assert.throws(() => packUrl(project, 512), /capacity/);
});
