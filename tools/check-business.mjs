import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { locatorOf } from "../lib/submissions.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const ajv = new Ajv({ allErrors: true, strict: true });
const schema = name => JSON.parse(fs.readFileSync(path.join(root, "schema", name + ".schema.json"), "utf8"));
const entry = ajv.compile(schema("entry"));
const member = ajv.compile(schema("member"));
const ledgerEvent = ajv.compile(schema("ledger-event"));
const ledgerOperation = ajv.compile(schema("ledger-operation"));
const state = JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8"));
const slots = new Set();
for (const record of Object.values(state.entries)) {
  if (!/^CC-\d{6}$/.test(record.id)) throw new Error("Invalid entry identity");
  const value = JSON.parse(fs.readFileSync(path.join(root, "entries", record.id + ".json"), "utf8"));
  if (!entry(value)) throw new Error("Entry schema failed: " + record.id + " " + JSON.stringify(entry.errors));
  if (value.id !== record.id || value.slot !== record.slot || value.status !== record.status) throw new Error("Entry registry does not match record");
  if (value.locator !== locatorOf(value.slot) || slots.has(value.slot)) throw new Error("Duplicate or invalid stable location");
  slots.add(value.slot);
  if (value.images.avatars.length > value.players.length) throw new Error("Avatar count exceeds linked players");
  for (const file of [value.images.main, ...value.images.memorial, ...value.images.avatars].filter(Boolean))
    if (!fs.existsSync(path.join(root, file))) throw new Error("Missing approved image " + file);
}
if (slots.size > 4096) throw new Error("Capacity exceeded");
for (const record of Object.values(state.members)) {
  if (!member(record)) throw new Error("Member schema failed: " + record.github_id + " " + JSON.stringify(member.errors));
  if (!Number.isSafeInteger(record.github_id) || !Number.isInteger(record.credits) || record.credits < 0) throw new Error("Invalid member credit state");
}
const operations = fs.readdirSync(path.join(root, "ledger")).filter(name => name.endsWith(".json"));
for (const name of operations) {
  const record = JSON.parse(fs.readFileSync(path.join(root, "ledger", name), "utf8"));
  if (!ledgerOperation(record)) throw new Error("Ledger operation schema failed: " + name + " " + JSON.stringify(ledgerOperation.errors));
  for (const event of record.events || []) {
    const row = { entry_id: null, review_id: null, ...event };
    if (!ledgerEvent(row)) throw new Error("Ledger event schema failed in " + name + " " + JSON.stringify(ledgerEvent.errors));
  }
}
console.log("PASS business source registry: " + slots.size + " entries, " + Object.keys(state.members).length + " members, " + operations.length + " ledger operations");
