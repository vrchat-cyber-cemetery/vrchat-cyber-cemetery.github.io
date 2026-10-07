import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { sha256 } from "../lib/publication.mjs";

// Fills the real container hashes into the publication record after the shard archives exist,
// then validates the record against its schema. The workflow passes the archive directory.
const root = fileURLToPath(new URL("../", import.meta.url));
const templatePath = process.argv[2];
const archiveDir = process.argv[3];
const record = JSON.parse(fs.readFileSync(templatePath, "utf8"));
for (const archive of record.archives) {
  const name = archive.repository.split("/")[1];
  const file = path.join(archiveDir, name + ".zip");
  if (!fs.existsSync(file)) throw new Error("缺少分片档案:" + file);
  archive.sha256 = sha256(fs.readFileSync(file));
  archive.bytes = fs.statSync(file).size;
}
const validator = new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(fs.readFileSync(path.join(root, "schema/publication.schema.json"), "utf8")));
if (!validator(record)) throw new Error("发布记录不满足契约: " + JSON.stringify(validator.errors));
fs.writeFileSync(path.join(path.dirname(templatePath), record.publication_id + ".json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ publication_id: record.publication_id, archives: record.archives.map(a => ({ repository: a.repository, sha256: a.sha256.slice(0, 12), bytes: a.bytes })) }));
