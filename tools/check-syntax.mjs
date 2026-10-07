import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const targets = [];
for (const dir of ["tools", "lib"]) for (const name of fs.readdirSync(path.join(root, dir))) if (name.endsWith(".mjs")) targets.push(path.join(root, dir, name));
for (const file of targets) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
console.log("PASS syntax gate: " + targets.length + " modules parse");
