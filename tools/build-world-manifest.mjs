import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { buildAddressManifest, catalogUrl, regionUrl } from "../lib/runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const manifest = buildAddressManifest(project);
const validate = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(path.join(root, "schema/address-manifest.schema.json"), "utf8")));
if (!validate(manifest)) throw new Error("Address manifest violates its own contract: " + JSON.stringify(validate.errors));
const output = path.join(root, "build/world/addresses.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");

// Export the same manifest into the sibling world repository so its editor tool imports one authoritative list.
const worldConfigPath = path.resolve(root, "../world/config/repository.json");
const worldOutputPath = path.resolve(root, "../world/config/addresses.json");
let worldImport = null;
if (fs.existsSync(worldConfigPath)) {
  const world = JSON.parse(fs.readFileSync(worldConfigPath, "utf8"));
  const expected = [
    ["catalog_url", world.catalog_url, catalogUrl(project)],
    ["regions_base", world.regions_base, project.site_base + "/regions"],
    ["data_site_bases", JSON.stringify(world.data_site_bases), JSON.stringify(project.data_site_bases)],
    ["layout_version", world.layout_version, project.layout_version],
    ["protocol_version", String(world.protocol_version), String(project.protocol_version)]
  ].filter(([, a, b]) => a !== b);
  if (expected.length) throw new Error("World repository configuration disagrees with project config: " + expected.map(([name]) => name).join(", "));
  fs.writeFileSync(worldOutputPath, JSON.stringify(manifest, null, 2) + "\n");
  worldImport = "../world/config/addresses.json";
}
console.log(JSON.stringify({ ...manifest.counts, output: "build/world/addresses.json", worldImport }));
