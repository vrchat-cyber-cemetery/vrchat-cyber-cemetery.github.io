import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseSubmission, revisionOf, emptyState, acceptSubmission, changeVisibility, locatorOf, parseLocator } from "../lib/submissions.mjs";
import { buildSite, renderEntry } from "../lib/site.mjs";
import { normalizeImage, fetchImage } from "../lib/media.mjs";
import { GitHub } from "../lib/github.mjs";

const root = path.resolve(".");
const project = JSON.parse(fs.readFileSync("config/project.json", "utf8"));
const policy = JSON.parse(fs.readFileSync("config/policy.json", "utf8"));
const moderator = policy.maintainers[0].github_id;
const noMedia = { main: null, memorial: [], avatars: [] };
const fixture = () => ({
  number: 9, user: { id: 123456, login: "test-contributor" },
  body: "### 这里埋葬了什么\n\n一个未完成的项目\n\n### 对象类型\n\n项目或世界（project）\n\n### 自定义标题\n\n_No response_\n\n### 墓志铭\n\n我们认真地尝试过。\n\n### 故事\n\n这只是测试数据。\n\n### 公开与授权\n\n- [x] 我理解投稿、图片和Git历史会公开。\n- [x] 我具备文字和图片使用授权。\n- [x] 涉及他人时已取得同意，不捏造死亡或公开隐私。"
});
const draft = () => parseSubmission(fixture());
const accepted = () => acceptSubmission(emptyState(), draft(), moderator, policy, noMedia, "2026-10-03T00:00:00.000Z");

test("native Issue Form normalizes a text-only non-player memorial", () => {
  const d = draft(); assert.equal(d.buried_type, "project"); assert.equal(d.players.length, 0); assert.equal(d.title, "这里埋葬了一个未完成的项目");
});
test("unchecked permission is rejected", () => {
  const issue = fixture(); issue.body = issue.body.replace("- [x] 我具备", "- [ ] 我具备");
  assert.throws(() => parseSubmission(issue), /确认/);
});
test("duplicate consent heading cannot replace declarations", () => {
  const issue = fixture(); issue.body += "\n\n### 公开与授权\n\n- [x] 公开"; assert.throws(() => parseSubmission(issue), /重复/);
});
test("unknown object type is rejected", () => {
  const issue = fixture(); issue.body = issue.body.replace("项目或世界（project）", "unknown"); assert.throws(() => parseSubmission(issue), /类型/);
});
test("four related players are rejected", () => {
  const issue = fixture(); issue.body += "\n\n### 相关玩家\n\nA\nB\nC\nD"; assert.throws(() => parseSubmission(issue), /三名/);
});
test("external image fetch URLs are rejected", () => {
  const issue = fixture(); issue.body += "\n\n### 主图\n\n![图](https://127.0.0.1/private)"; assert.throws(() => parseSubmission(issue), /附件/);
});
test("content revision changes when the Issue is edited", () => assert.notEqual(revisionOf(fixture().body), revisionOf(fixture().body + "改动")));
test("first creation grants once, consumes once and assigns a stable location", () => {
  const r = accepted(); assert.equal(r.state.members["123456"].credits, 0); assert.equal(r.events.length, 2); assert.equal(r.entry.id, "CC-000001"); assert.equal(r.entry.locator, "01-01");
});
test("repeating the same accepted revision does not double charge", () => {
  const r = accepted(), replay = acceptSubmission(r.state, draft(), moderator, policy, noMedia);
  assert(replay.duplicate); assert.equal(replay.state.next_entry, 2); assert.equal(replay.state.members["123456"].credits, 0);
});
test("two creates against a one-credit latest state accept only one", () => {
  const r = accepted(), next = draft(); next.issue_number = 10; next.revision = revisionOf("another");
  assert.throws(() => acceptSubmission(r.state, next, moderator, policy, noMedia), /剩余/); assert.equal(Object.keys(r.state.entries).length, 1);
});
test("rename does not grant another initial credit", () => {
  const r = accepted(), next = draft(); next.author.login = "renamed"; next.issue_number = 11; next.revision = revisionOf("rename");
  assert.throws(() => acceptSubmission(r.state, next, moderator, policy, noMedia), /剩余/);
});
test("self approval is rejected before consuming credits", () => assert.throws(() => acceptSubmission(emptyState(), draft(), 123456, { ...policy, maintainers: [{ github_id: 123456 }] }, noMedia), /自己/));
test("ordinary visitors cannot publish", () => assert.throws(() => acceptSubmission(emptyState(), draft(), 98765, policy, noMedia), /维护者/));
test("approved edit retains location and does not consume creation credits", () => {
  const r = accepted(), next = draft(); next.entry_id = r.entry.id; next.issue_number = 12; next.revision = revisionOf("edit"); next.story = "修改后的测试";
  const edited = acceptSubmission(r.state, next, moderator, policy, noMedia);
  assert.equal(edited.entry.locator, r.entry.locator); assert.equal(edited.state.members["123456"].credits, 0); assert.equal(edited.events.length, 0); assert.equal(edited.entry.request_issue_number, 12);
});
test("removal keeps location reserved and does not refund", () => {
  const r = accepted(), hidden = changeVisibility(r.state, r.entry, "removed", moderator, policy, "remove:1");
  assert.equal(hidden.state.entries[r.entry.id].slot, 0); assert.equal(hidden.state.members["123456"].credits, 0);
});
test("visibility replay is idempotent", () => {
  const r = accepted(), hidden = changeVisibility(r.state, r.entry, "hidden", moderator, policy, "hide:1");
  assert(changeVisibility(hidden.state, hidden.entry, "hidden", moderator, policy, "hide:1").duplicate);
});
test("locator maps all valid boundary values", () => {
  assert.equal(locatorOf(0), "01-01"); assert.equal(locatorOf(4095), "64-64"); assert.equal(parseLocator("12-34"), 737);
  assert.throws(() => parseLocator("00-34")); assert.throws(() => parseLocator("65-01"));
});
test("rendered user text cannot inject markup", () => {
  const r = accepted(); r.entry.buried_subject = '<img src=x onerror="alert(1)">';
  const html = renderEntry(r.entry, project); assert(!html.includes('<img src=x')); assert(html.includes("&lt;img"));
});
test("withdrawn page and listing contain no withdrawn body or photos", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-site-"));
  try {
    const r = accepted(); r.entry.status = "removed"; r.entry.story = "PRIVATE_TEST_MARKER";
    buildSite(root, dir, project, policy, r.state, [r.entry]);
    assert(!fs.readFileSync(path.join(dir, "entries", r.entry.id, "index.html"), "utf8").includes("PRIVATE_TEST_MARKER"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "memorials.json"), "utf8")).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("website renders text-only accepted records and preserves pending world state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cemetery-site-"));
  try {
    const r = accepted(); buildSite(root, dir, project, policy, r.state, [r.entry]);
    const html = fs.readFileSync(path.join(dir, "entries", r.entry.id, "index.html"), "utf8");
    assert(html.includes("01-01")); assert(html.includes("尚未上线") || html.includes("正在建设"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8")).world_status, "awaiting_world");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("image normalization preserves ratio and returns a bounded hashed JPEG", async () => {
  const png = await sharp({ create: { width: 120, height: 60, channels: 3, background: "#789876" } }).png().toBuffer();
  const result = await normalizeImage(png), info = await sharp(result.bytes).metadata();
  assert.equal(info.width / info.height, 2); assert.equal(info.format, "jpeg"); assert.match(result.path, /^media\/[a-f0-9]{64}\.jpg$/);
});
test("SVG image attachments are not accepted", async () => await assert.rejects(() => normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), /静态/));
test("attachment redirects cannot reach an arbitrary origin", async () => {
  const request = async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } });
  await assert.rejects(() => fetchImage("https://github.com/user-attachments/assets/test", request), /来源/);
});
test("receipt updater uses the proper comment endpoint", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options.method]);
    return new Response(JSON.stringify(options.method === "GET" ? [{ id: 42, user: { type: "Bot" }, body: "<!-- cyber-cemetery-receipt --> old" }] : {}), { status: 200 });
  };
  await new GitHub("example/repo", "test-token", request).receipt(9, "new");
  assert(calls.some(([url, method]) => url.endsWith("/issues/comments/42") && method === "PATCH"));
});
test("Git update keeps a single parent and never forces a branch update", async () => {
  const calls = [];
  const request = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, method: options.method, body });
    return new Response(JSON.stringify({ sha: url.endsWith("/git/trees") ? "new-tree" : "new-commit" }), { status: 200 });
  };
  await new GitHub("example/repo", "test-token", request).commit({ sha: "expected-head", tree: "base-tree" }, { "data/state.json": "{}" }, "test");
  const ref = calls.find(x => x.method === "PATCH"); assert.equal(ref.body.force, false);
  assert.deepEqual(calls.find(x => x.url.endsWith("/git/commits")).body.parents, ["expected-head"]);
});
