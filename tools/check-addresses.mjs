import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { buildAddressManifest } from "../lib/runtime.mjs";

// Verifies every fixed address is a direct HTTP 200 without redirects, that JSON endpoints
// satisfy their runtime contracts and that deployed pack bytes match the approved SHA-256 manifest.
const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const manifest = buildAddressManifest(project);
const ajv = new Ajv({ allErrors: true, strict: true });
const schema = name => ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", name + ".schema.json"), "utf8")));
const validators = { catalog: schema("catalog"), region: schema("region") };
const hashes = new Map();
for (const shard of project.repositories.shards) {
  const list = JSON.parse(fs.readFileSync(path.join(root, "build/shards", shard, "manifest.json"), "utf8"));
  for (const pack of list.packs) hashes.set("https://" + project.organization + ".github.io/" + shard + "/packs/" + String(pack.pack).padStart(3, "0") + ".bin", pack.sha256);
}

const failures = [];
let checked = 0;
async function verify(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status !== 200) throw new Error("HTTP " + response.status + (response.headers.get("location") ? " -> " + response.headers.get("location") : ""));
    if (url.endsWith(".bin")) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const expected = hashes.get(url);
      const actual = crypto.createHash("sha256").update(bytes).digest("hex");
      if (expected && actual !== expected) throw new Error("sha256 drift");
    } else {
      const value = await response.json();
      const validator = url.endsWith("catalog.json") ? validators.catalog : validators.region;
      if (!validator(value)) throw new Error("contract violation: " + ajv.errorsText(validator.errors).slice(0, 120));
    }
  } catch (error) {
    failures.push({ url, error: String(error.message || error) });
  } finally {
    checked++;
    if (checked % 96 === 0) process.stdout.write("  " + checked + "/" + manifest.counts.total + "\n");
  }
}
const queue = [manifest.catalog, ...manifest.regions, ...manifest.packs];
const workers = Array.from({ length: 16 }, async () => { while (queue.length) await verify(queue.shift()); });
await Promise.all(workers);

const result = {
  date: new Date().toISOString(),
  total: manifest.counts.total,
  ok: manifest.counts.total - failures.length,
  failed: failures.length,
  classes: { catalog: 1, regions: manifest.regions.length, packs: manifest.packs.length },
  redirects_or_errors: failures
};
const output = process.argv[2];
if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, redirects_or_errors: failures.length ? failures.slice(0, 5) : [] }));
if (failures.length) process.exitCode = 1;
