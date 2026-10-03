import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skipped = new Set([".git", "node_modules", "build", "dist", "coverage"]);
const documents = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (entry.isFile() && filename.endsWith(".md")) documents.push(filename);
  }
}
walk(root);
const errors = [];
let checkedLocalLinks = 0;
for (const filename of documents) {
  const content = fs.readFileSync(filename, "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    const target = decodeURIComponent(href.split("#")[0]);
    if (target) checkedLocalLinks++;
    if (target && !fs.existsSync(path.resolve(path.dirname(filename), target))) errors.push(path.relative(root, filename) + ": missing " + target);
  }
}
const requirementText = fs.readFileSync(path.join(root, "requirements/REQUIREMENTS.md"), "utf8");
const definitions = [...requirementText.matchAll(/^(?:\| |\*\*)(REQ-\d{2})(?: \||：)/gm)].map(match => match[1]);
const acceptance = requirementText.split("## 7. 验收矩阵")[1]?.split("## 8.")[0] || "";
if (definitions.length < 48) errors.push("Expected at least 48 documented requirements");
if (checkedLocalLinks === 0) errors.push("No local document links were checked");
for (const id of definitions) {
  if (definitions.filter(value => value === id).length !== 1) errors.push("Duplicate requirement " + id);
  if (!acceptance.includes(id)) errors.push("No acceptance coverage for " + id);
}
const ac = [...requirementText.matchAll(/^\| (AC-\d{2}) /gm)].map(match => match[1]);
if (ac.length < 24) errors.push("Expected at least 24 acceptance scenarios");
const testPlan = fs.readFileSync(path.join(root, "plans/TEST-RELEASE.md"), "utf8");
for (const id of ac) if (!testPlan.includes(id)) errors.push("No test-plan mapping for " + id);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("PASS " + documents.length + " documents, " + checkedLocalLinks + " local links, " + definitions.length + " requirements, " + ac.length + " acceptance mappings");
