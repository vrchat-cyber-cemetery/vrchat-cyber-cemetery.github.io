import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { packMetadata } from "../lib/runtime.mjs";

const HEADER = 32;
const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const published = Object.values(state.entries).map(x => JSON.parse(fs.readFileSync(path.join(root, "entries", x.id + ".json"), "utf8"))).filter(x => x.status === "published");
const validator = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(path.join(root, "schema/pack-metadata.schema.json"), "utf8")));

// A pack always carries the 32-byte CCPACK01 header followed by JSON; texture length stays 0 until GH-03 builds atlases.
function encode(meta) {
  if (!validator(meta)) throw new Error("Pack metadata violates its contract: " + JSON.stringify(validator.errors));
  const json = Buffer.from(JSON.stringify(meta), "utf8");
  if (json.length < 1 || json.length > 131072) throw new Error("Pack JSON outside protocol bounds");
  const pack = Buffer.alloc(HEADER + json.length);
  pack.write("CCPACK01", 0, "ascii");
  pack.writeUInt32LE(json.length, 8);
  pack.writeUInt32LE(0, 12);
  pack.writeUInt16LE(0, 16);
  pack.writeUInt16LE(0, 18);
  pack[20] = 0;
  pack[21] = 0;
  pack.writeUInt16LE(0, 22);
  json.copy(pack, HEADER);
  if (pack.length > project.budgets.max_pack_bytes) throw new Error("Pack exceeds hard byte budget");
  return pack;
}

const shards = project.repositories.shards.map(name => {
  const output = path.join(root, "build/shards", name);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, "packs"), { recursive: true });
  return { name, output, packs: [] };
});

for (let index = 0; index < project.capacity.pack_count; index++) {
  const region = Math.floor(index / 8), group = index % 8;
  const pack = encode(packMetadata(project, published, region, group));
  const shard = shards[Math.floor(index / (project.capacity.pack_count / shards.length))];
  fs.writeFileSync(path.join(shard.output, "packs", String(index).padStart(3, "0") + ".bin"), pack);
  shard.packs.push({ pack: index, region, group, revision: packMetadata(project, published, region, group).revision, bytes: pack.length, sha256: crypto.createHash("sha256").update(pack).digest("hex") });
}
for (const shard of shards) {
  const manifest = {
    schema: 1, community_id: project.community_id, protocol_version: project.protocol_version, layout_version: project.layout_version,
    repository: project.organization + "/" + shard.name, pack_count: shard.packs.length,
    max_pack_bytes: project.budgets.max_pack_bytes, total_bytes: shard.packs.reduce((sum, p) => sum + p.bytes, 0), packs: shard.packs
  };
  fs.writeFileSync(path.join(shard.output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (manifest.total_bytes > project.budgets.site_bytes) throw new Error("Shard output exceeds approved site budget");
  // Export into the sibling shard repository when it is checked out next to this repository.
  // Only packs and the manifest are owned by this builder; hand-maintained pages must survive.
  const sibling = path.resolve(root, "..", shard.name, "public");
  if (fs.existsSync(path.resolve(root, "..", shard.name, "config"))) {
    fs.rmSync(path.join(sibling, "packs"), { recursive: true, force: true });
    fs.mkdirSync(path.join(sibling, "packs"), { recursive: true });
    for (const pack of shard.packs) fs.copyFileSync(path.join(shard.output, "packs", String(pack.pack).padStart(3, "0") + ".bin"), path.join(sibling, "packs", String(pack.pack).padStart(3, "0") + ".bin"));
    fs.copyFileSync(path.join(shard.output, "manifest.json"), path.join(sibling, "manifest.json"));
  }
}
const summary = shards.map(shard => ({ repository: shard.name, pack_count: shard.packs.length, total_bytes: shard.packs.reduce((sum, p) => sum + p.bytes, 0) }));
console.log(JSON.stringify({ packs: project.capacity.pack_count, published_entries: published.length, output: "build/shards", shards: summary }));
