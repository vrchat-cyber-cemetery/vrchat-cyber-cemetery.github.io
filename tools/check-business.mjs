import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { locatorOf } from "../lib/submissions.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema/entry.schema.json"), "utf8"));
const validator = new Ajv({ allErrors: true, strict: true }).compile(schema);
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const slots = new Set();
for (const record of Object.values(state.entries)) {
  if (!/^CC-\d{6}$/.test(record.id)) throw new Error("Invalid entry identity");
  const entry = JSON.parse(fs.readFileSync(path.join(root, "entries", record.id + ".json"), "utf8"));
  if (!validator(entry)) throw new Error("Entry schema failed: " + record.id + " " + JSON.stringify(validator.errors));
  if (entry.id !== record.id || entry.slot !== record.slot || entry.status !== record.status) throw new Error("Entry registry does not match record");
  if (entry.locator !== locatorOf(entry.slot) || slots.has(entry.slot)) throw new Error("Duplicate or invalid stable location");
  slots.add(entry.slot);
  if (entry.images.avatars.length > entry.players.length) throw new Error("Avatar count exceeds linked players");
  for (const file of [entry.images.main, ...entry.images.memorial, ...entry.images.avatars].filter(Boolean))
    if (!fs.existsSync(path.join(root, file))) throw new Error("Missing approved image " + file);
}
if (slots.size > 4096) throw new Error("Capacity exceeded");
for (const member of Object.values(state.members)) {
  if (!Number.isSafeInteger(member.github_id) || !Number.isInteger(member.credits) || member.credits < 0) throw new Error("Invalid member credit state");
}
console.log("PASS business source registry: " + slots.size + " entries");
