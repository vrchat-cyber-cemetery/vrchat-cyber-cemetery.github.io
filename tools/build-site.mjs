import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../lib/site.mjs";
import sharp from "sharp";
import crypto from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "build/site");
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/policy.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const entries = Object.values(state.entries).map(x => JSON.parse(fs.readFileSync(path.join(root, "entries", x.id + ".json"), "utf8")));
fs.rmSync(output, { recursive: true, force: true });
const result = buildSite(root, output, project, policy, state, entries);
await sharp(path.join(root, "site/assets/share.svg")).png().toFile(path.join(output, "assets/share.png"));
// New HTML refers to content-addressed client assets; cached older HTML can still use the original paths.
const substitutions = [];
for (const filename of ["app.js", "style.css"]) {
  const source = path.join(output, "assets", filename);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 12);
  const versioned = filename.replace(".", "." + hash + ".");
  fs.copyFileSync(source, path.join(output, "assets", versioned));
  substitutions.push(["/assets/" + filename, "/assets/" + versioned]);
}
function versionHtml(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) versionHtml(file);
    else if (file.endsWith(".html")) {
      let html = fs.readFileSync(file, "utf8");
      for (const [before, after] of substitutions) html = html.replaceAll(before, after);
      fs.writeFileSync(file, html);
    }
  }
}
versionHtml(output);
function bytes(directory) { return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? bytes(path.join(directory, item.name)) : fs.statSync(path.join(directory, item.name)).size), 0); }
const size = bytes(output);
if (size > project.budgets.site_bytes) throw new Error("Published site exceeds approved size budget");
console.log(JSON.stringify({ ...result, bytes: size, pagesOutput: "build/site", worldReady: false }));
