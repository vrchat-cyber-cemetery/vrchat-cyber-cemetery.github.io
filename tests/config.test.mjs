import test from "node:test";
import assert from "node:assert/strict";
import { readConfigurations, validateConfigurations } from "../tools/check-config.mjs";
const fresh = () => structuredClone(readConfigurations());

test("approved same-repository pilot validates without enabling rewards", () => assert.deepEqual(validateConfigurations(fresh()), []));
test("incorrect organization site is rejected", () => {
  const config = fresh(); config.project.site_base = "https://example.com";
  assert(validateConfigurations(config).some(error => error.includes("Main site")));
});
test("incorrect shard paths are rejected", () => {
  const config = fresh(); config.project.data_site_bases.reverse();
  assert(validateConfigurations(config).some(error => error.includes("Data site")));
});
test("wrong capacity cannot silently change the protocol", () => {
  const config = fresh(); config.project.capacity.pack_count = 1024;
  assert(validateConfigurations(config).length > 0);
});
test("unexpected private-key material is rejected by schema", () => {
  const config = fresh(); config["automation-app"].private_key = "not-a-real-key";
  assert(validateConfigurations(config).length > 0);
});
test("App cannot include the Unity repository", () => {
  const config = fresh(); config["automation-app"].installation_repositories[2] = "world";
  assert(validateConfigurations(config).some(error => error.includes("limited")));
});
test("duplicate maintainer IDs do not satisfy independence", () => {
  const config = fresh(); config.policy.maintainers.push({ ...config.policy.maintainers[0] });
  assert(validateConfigurations(config).some(error => error.includes("unique")));
});
test("real rewards remain disabled until independent confirmation is possible", () => {
  const config = fresh(); config.policy.real_rewards_enabled = true;
  assert(validateConfigurations(config).some(error => error.includes("independent")));
});
test("app-mode intake stays blocked while the App is unregistered", () => {
  const config = fresh(); config.policy.automatic_intake_enabled = true; config.policy.intake_mode = "app"; config["automation-app"].status = "not_registered";
  assert(validateConfigurations(config).some(error => error.includes("ready")));
});
test("installed App satisfies the registration gate for app-mode intake", () => {
  const config = fresh(); config.policy.automatic_intake_enabled = true; config.policy.intake_mode = "app";
  const errors = validateConfigurations(config);
  assert(!errors.some(error => error.includes("ready")), "registered App must not be reported as unregistered: " + errors.join("; "));
});
