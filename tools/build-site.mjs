import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../lib/site.mjs";
import sharp from "sharp";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "build/site");
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const entries = Object.values(state.entries).map(x => JSON.parse(fs.readFileSync(path.join(root, "entries", x.id + ".json"), "utf8")));
fs.rmSync(output, { recursive: true, force: true });
const result = buildSite(root, output, project, state, entries);
await sharp(path.join(root, "site/assets/share.svg")).png().toFile(path.join(output, "assets/share.png"));
function bytes(directory) { return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? bytes(path.join(directory, item.name)) : fs.statSync(path.join(directory, item.name)).size), 0); }
const size = bytes(output);
if (size > project.budgets.site_bytes) throw new Error("Published site exceeds approved size budget");
console.log(JSON.stringify({ ...result, bytes: size, pagesOutput: "build/site", worldReady: false }));
