import test from "node:test";
import assert from "node:assert/strict";
import { readConfigurations, validateConfigurations } from "../tools/check-config.mjs";
const fresh = () => structuredClone(readConfigurations());

test("approved pilot configuration validates with automation off", () => assert.deepEqual(validateConfigurations(fresh()), []));
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
test("intake cannot be enabled while the App is unregistered", () => {
  const config = fresh(); config.policy.automatic_intake_enabled = true;
  assert(validateConfigurations(config).some(error => error.includes("ready")));
});
