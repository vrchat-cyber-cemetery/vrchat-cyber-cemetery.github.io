import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const root = fileURLToPath(new URL("../", import.meta.url));
const ajv = new Ajv({ allErrors: true, strict: true });
const names = ["project", "policy", "automation-app"];
const validators = Object.fromEntries(names.map(name => [name, ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema", name + ".schema.json"), "utf8")))]));

export function readConfigurations(directory = root) {
  return Object.fromEntries(names.map(name => [name, JSON.parse(fs.readFileSync(path.join(directory, "config", name + ".json"), "utf8"))]));
}

export function validateConfigurations(data) {
  const errors = [];
  for (const name of names) {
    if (!validators[name](data[name])) errors.push(name + ": " + ajv.errorsText(validators[name].errors));
  }
  if (errors.length) return errors;
  const project = data.project, policy = data.policy, app = data["automation-app"];
  const site = "https://" + project.organization + ".github.io";
  if (project.repositories.main !== project.organization + ".github.io") errors.push("Organization Pages repository name does not match organization");
  if (project.site_base !== site) errors.push("Main site base does not match organization");
  if (project.community_id !== project.organization) errors.push("Community identity does not match organization");
  const expectedShards = project.repositories.shards.map(name => site + "/" + name);
  if (JSON.stringify(project.data_site_bases) !== JSON.stringify(expectedShards)) errors.push("Data site paths do not match shard repositories");
  const installed = [project.repositories.main, ...project.repositories.shards].sort();
  if (JSON.stringify([...app.installation_repositories].sort()) !== JSON.stringify(installed)) errors.push("Automation App must be limited to primary and data repositories");
  if (app.secret_repository !== project.repositories.main) errors.push("App private key Secret belongs only in primary repository");
  const ids = policy.maintainers.map(member => member.github_id);
  if (new Set(ids).size !== ids.length) errors.push("Maintainer numeric identities must be unique");
  if (policy.real_rewards_enabled && ids.length < 2) errors.push("Real rewards require two independent maintainers");
  if (policy.real_rewards_enabled && app.status !== "installed") errors.push("Real rewards require the registered automation App");
  if (policy.automatic_intake_enabled && policy.intake_mode !== "same_repository" && app.status !== "installed") errors.push("App-mode intake cannot be enabled before its App is ready");
  if ((policy.real_rewards_enabled || policy.automatic_intake_enabled) && policy.implementation_status === "not_implemented") errors.push("Automation cannot be enabled before its implementation is ready");
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateConfigurations(readConfigurations());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("PASS project and approved policy: intake=" + readConfigurations().policy.automatic_intake_enabled + ", rewards=" + readConfigurations().policy.real_rewards_enabled);
}
