import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { packMetadata } from "../lib/runtime.mjs";
import { atlasCells, bc1BlocksFromDDS, encodePack, checkBudgets, publicationRecord, sha256, TEXCONV, ATLAS_BACKGROUND } from "../lib/publication.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const published = Object.values(state.entries).map(x => JSON.parse(fs.readFileSync(path.join(root, "entries", x.id + ".json"), "utf8"))).filter(x => x.status === "published");
const validator = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(path.join(root, "schema/publication.schema.json"), "utf8")));
const source_sha = process.env.PUBLICATION_SOURCE_SHA || (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
const texconv = process.env.TEXCONV_PATH;
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "publication-"));

function imagesOf(entry) {
  return { main: entry.images.main, memorial: entry.images.memorial, avatars: entry.images.avatars };
}
function hasAnyImage(entry) {
  const i = entry.images;
  return Boolean(i.main) || i.memorial.some(Boolean) || i.avatars.some(Boolean);
}

// Compose one 2048×2048 atlas for a group: strips per entry, cells per logical image, letterboxed.
async function buildAtlas(entries) {
  const layers = [];
  entries.forEach((entry, strip) => {
    const cells = atlasCells(strip);
    const sources = [
      { cell: cells.find(c => c.role === "main"), buffer: entry.images.main },
      ...entry.images.memorial.filter(Boolean).map((buffer, i) => ({ cell: cells.filter(c => c.role === "memorial")[i], buffer })),
      ...entry.images.avatars.filter(Boolean).map((buffer, i) => ({ cell: cells.filter(c => c.role === "avatar")[i], buffer }))
    ].filter(x => x.cell && x.buffer);
    for (const { cell, buffer } of sources) {
      const tile = sharp(path.join(root, buffer)).resize(cell.size, cell.size, { fit: "contain", background: ATLAS_BACKGROUND }).png().toBuffer();
      layers.push({ input: tile, left: cell.x, top: cell.y });
    }
  });
  const atlas = path.join(workdir, "atlas-" + crypto.randomUUID().slice(0, 8) + ".png");
  await sharp({ create: { width: 2048, height: 2048, channels: 3, background: ATLAS_BACKGROUND } }).composite(layers).png().toFile(atlas);
  return atlas;
}

async function textureFor(entries) {
  const withImages = entries.filter(hasAnyImage);
  if (!withImages.length) return null;
  if (!texconv) throw new Error("存在带图条目,但未提供固定版本的texconv(TEXCONV_PATH)。");
  const actual = sha256(fs.readFileSync(texconv));
  if (actual !== TEXCONV.sha256) throw new Error("texconv校验值不符:期望" + TEXCONV.sha256 + ",实际" + actual + "。");
  const atlas = await buildAtlas(withImages);
  const outdir = path.join(workdir, "dds");
  fs.mkdirSync(outdir, { recursive: true });
  await run(texconv, ["-f", "BC1_UNORM", "-m", "1", "-ft", "dds", "-o", outdir, "-y", atlas]);
  const dds = path.join(outdir, path.basename(atlas).replace(/\.png$/, ".dds"));
  return bc1BlocksFromDDS(fs.readFileSync(dds));
}

const shards = project.repositories.shards.map(name => ({ name, packs: [], total: 0 }));
const output = path.join(root, "build/publication");
fs.rmSync(output, { recursive: true, force: true });

for (let index = 0; index < project.capacity.pack_count; index++) {
  const region = Math.floor(index / 8), group = index % 8;
  const inPack = published.filter(x => Math.floor(x.slot / 64) === region && Math.floor((x.slot % 64) / 8) === group);
  const meta = packMetadata(project, published, region, group);
  const texture = await textureFor(inPack);
  const pack = encodePack(meta, texture);
  const shard = shards[Math.floor(index / (project.capacity.pack_count / shards.length))];
  shard.packs.push({ pack: index, region, group, revision: meta.revision, bytes: pack.length, sha256: sha256(pack) });
  shard.total += pack.length;
  fs.mkdirSync(path.join(output, shard.name, "packs"), { recursive: true });
  fs.writeFileSync(path.join(output, shard.name, "packs", String(index).padStart(3, "0") + ".bin"), pack);
}

const sequence = state.publication_sequence + 1;
const publicationId = "PB-" + String(sequence).padStart(6, "0");
const archives = [];
for (const shard of shards) {
  fs.writeFileSync(path.join(output, shard.name, "manifest.json"), JSON.stringify({
    schema: 1, community_id: project.community_id, protocol_version: project.protocol_version, layout_version: project.layout_version,
    repository: project.organization + "/" + shard.name, pack_count: shard.packs.length,
    max_pack_bytes: project.budgets.max_pack_bytes, total_bytes: shard.total,
    publication: { publication_id: publicationId, publication_sequence: sequence, source_sha },
    packs: shard.packs
  }, null, 2) + "\n");
  // Archives are assembled as deterministic zip stores by the workflow for large payloads;
  // the record pins the pack hashes, so the container hash is computed after zipping.
  archives.push({ repository: shard.name, role: shard.name.endsWith("0") ? "shard-0" : "shard-1", packs: shard.packs.length, total_bytes: shard.total });
}

const siteBytes = Number(process.env.PUBLICATION_SITE_BYTES || 0);
const budgets = checkBudgets(project, Object.fromEntries(shards.map(s => [s.name, s.total])), siteBytes);
// Archive container hashes are unknown until the workflow zips each shard directory;
// the template intentionally leaves them empty and finalize-record.mjs fills the real values.
const record = publicationRecord({
  publication_id: publicationId, sequence, source_sha, project,
  archives: archives.map(a => ({ repository: project.organization + "/" + a.repository, role: a.role, url: "https://github.com/" + project.organization + "/" + project.repositories.main + "/releases/download/publication-" + publicationId + "/" + a.repository + ".zip", sha256: "", bytes: a.total_bytes })),
  requested_by: Number(process.env.PUBLICATION_REQUESTED_BY || 11071219),
  requested_at: new Date().toISOString()
});
fs.mkdirSync(path.join(output, "record"), { recursive: true });
fs.writeFileSync(path.join(output, "record", publicationId + ".template.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ publication_id: publicationId, sequence, source_sha, packs: project.capacity.pack_count, packs_with_texture: published.filter(hasAnyImage).length, budgets, output: "build/publication" }));
