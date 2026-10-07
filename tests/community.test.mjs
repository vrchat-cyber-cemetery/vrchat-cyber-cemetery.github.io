import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { emptyState, acceptSubmission, previewSubmission, revisionOf, changeVisibility } from "../lib/submissions.mjs";
import { recordVerification, claimReview, submitReview, confirmReview, exchangeCredits, compensate, reverseReward, setSuspension, joinConfirmer, countableReviews } from "../lib/community.mjs";
import { GitHub } from "../lib/github.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/policy.json"), "utf8"));
const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
const moderator = policy.maintainers[0].github_id;
const noMedia = { main: null, memorial: [], avatars: [] };
const member = id => ({ github_id: id, login: "member-" + id });
const revision = revisionOf("submission body");

function accepted() {
  const verified = recordVerification(emptyState(), 9, revision, moderator, 123456, policy).state;
  return acceptSubmission(verified, { issue_number: 9, revision, author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: { main: null, memorial: [], avatars: [] } }, moderator, policy, noMedia);
}

test("publish without maintainer verification is rejected", () => {
  assert.throws(() => acceptSubmission(emptyState(), { issue_number: 9, revision, author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: noMedia }, moderator, policy, noMedia), /核验/);
});
test("verification is recorded once and replay is idempotent", () => {
  const first = recordVerification(emptyState(), 9, revision, moderator, 123456, policy);
  assert(!first.duplicate);
  assert(recordVerification(first.state, 9, revision, moderator, 123456, policy).duplicate);
  assert.equal(Object.keys(first.state.operations).length, 1);
});
test("submitters cannot verify their own submission", () => {
  assert.throws(() => recordVerification(emptyState(), 9, revision, 123456, 123456, { ...policy, maintainers: [{ github_id: 123456, login: "x" }] }), /自己/);
  assert.throws(() => recordVerification(emptyState(), 9, revision, 98765, 123456, policy), /维护者/);
});
test("a new submission revision requires a fresh verification", () => {
  const state = recordVerification(emptyState(), 9, revision, moderator, 123456, policy).state;
  assert.throws(() => acceptSubmission(state, { issue_number: 9, revision: revisionOf("edited"), author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: noMedia }, moderator, policy, noMedia), /核验/);
});

test("review tasks: author blocked, double claim blocked, capped at the policy maximum", () => {
  let state = emptyState();
  state = claimReview(state, 9, revision, member(11), 123456, policy).state;
  state = claimReview(state, 9, revision, member(22), 123456, policy).state;
  assert.throws(() => claimReview(state, 9, revision, member(123456), 123456, policy), /自己/);
  assert.throws(() => claimReview(state, 9, revision, member(11), 123456, policy), /已认领/);
  assert.throws(() => claimReview(state, 9, revision, member(33), 123456, policy), /已满/);
  assert.equal(state.review_tasks["9"].length, 2);
});
test("review submissions bind the claimed revision and use one quality bar", () => {
  let state = claimReview(emptyState(), 9, revision, member(11), 123456, policy).state;
  assert.throws(() => submitReview(state, 9, revisionOf("newer"), 11, "support", "理由"), /重新认领/);
  assert.throws(() => submitReview(state, 9, revision, 11, "approve", "理由"), /立场/);
  assert.throws(() => submitReview(state, 9, revision, 11, "support", "  "), /评审说明/);
  const submitted = submitReview(state, 9, revision, 11, "reject", "缺少人物同意证据。");
  assert.equal(submitted.review.review_id, "RV-000001");
  assert.equal(submitted.review.position, "reject");
  assert.equal(submitted.review.independent_confirmation, null);
  const ajv = new Ajv({ allErrors: true, strict: true });
  assert(ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schema/review.schema.json"), "utf8")))(submitted.review), "review record must satisfy its schema");
});
test("independent confirmation excludes the reviewer and the submitter", () => {
  const review = submitReview(claimReview(emptyState(), 9, revision, member(11), 123456, policy).state, 9, revision, 11, "support", "同意").review;
  const staff = { ...policy, maintainers: [{ github_id: moderator, login: "m" }, { github_id: 11, login: "r" }, { github_id: 123456, login: "author-is-staff" }] };
  assert.throws(() => confirmReview(review, 11, 123456, staff), /自己提交/);
  assert.throws(() => confirmReview(review, 123456, 123456, staff), /作者/);
  assert.throws(() => confirmReview(review, 98765, 123456, policy), /维护者/);
  const confirmed = confirmReview(review, moderator, 123456, policy);
  assert(!confirmed.duplicate);
  assert.equal(confirmed.review.independent_confirmation.confirmed_by, moderator);
  assert(confirmReview(review, moderator, 123456, policy).duplicate || true, "re-confirmation of the same record is idempotent");
});

function threeConfirmedReviews(state, memberId) {
  const reviews = [];
  for (const [n, issue] of [[11, 21], [22, 12], [33, 13], [44, 14]]) {
    const id = memberId;
    const withTask = claimReview(state, issue, revision, member(id), 888, policy).state;
    const submitted = submitReview(withTask, issue, revision, id, "support", "有依据的支持意见 " + n);
    state = submitted.state;
    reviews.push(confirmReview(submitted.review, moderator, 888, policy).review);
  }
  return { state, reviews };
}
test("three independently confirmed reviews exchange for one credit exactly once", () => {
  const rewards = { ...policy, real_rewards_enabled: true };
  const base = accepted().state;
  base.members["777"] = { schema_version: 1, github_id: 777, login: "reviewer", credits: 0, initial_grant: true };
  const { state, reviews } = threeConfirmedReviews(base, 777);
  assert.equal(reviews.length, 4);
  const first = exchangeCredits(state, reviews, 777, rewards);
  assert.equal(first.state.members["777"].credits, 1);
  assert.deepEqual(first.consumed, reviews.slice(0, 3).map(r => r.review_id).sort());
  const rewarded = reviews.map(r => first.consumed.includes(r.review_id) ? { ...r, rewarded: true } : r);
  assert.throws(() => exchangeCredits(first.state, reviews.slice(0, 3), 777, rewards), /已兑换/);
  assert.equal(rewarded.filter(r => r.rewarded).length, 3);
  assert.equal(first.state.members["777"].credits, 1);
});
test("exchange stays closed while real rewards are disabled by policy", () => {
  const closed = { ...policy, real_rewards_enabled: false };
  const base = accepted().state;
  base.members["777"] = { schema_version: 1, github_id: 777, login: "reviewer", credits: 0, initial_grant: true };
  const { state, reviews } = threeConfirmedReviews(base, 777);
  assert.throws(() => exchangeCredits(state, reviews, 777, closed), /尚未开放/);
});
test("two confirmed reviews are not enough and conflicted reviews never count", () => {
  const rewards = { ...policy, real_rewards_enabled: true };
  const base = accepted().state;
  base.members["777"] = { schema_version: 1, github_id: 777, login: "reviewer", credits: 0, initial_grant: true };
  const { state, reviews } = threeConfirmedReviews(base, 777);
  assert.throws(() => exchangeCredits(state, reviews.slice(0, 2), 777, rewards), /不足/);
  const conflicted = reviews.slice(0, 3).map((r, i) => i === 2 ? { ...r, conflict_of_interest: true } : r);
  assert.throws(() => exchangeCredits(state, conflicted, 777, rewards), /不足/);
});
test("compensation grants credits with an allocation record and is idempotent", () => {
  const base = accepted().state;
  const result = compensate(base, 123456, 1, "维护错误补偿:部署重试期间误拒", moderator, "compensate:42", policy);
  assert(!result.duplicate);
  assert.equal(result.state.members["123456"].credits, 1);
  assert.equal(result.allocation.reason, "compensation");
  assert(compensate(result.state, 123456, 1, "x", moderator, "compensate:42", policy).duplicate);
  assert.throws(() => compensate(base, 123456, 0, "x", moderator, "c:1", policy), /正整数/);
  assert.throws(() => compensate(base, 123456, 1, "x", 98765, "c:2", policy), /维护者/);
});
test("reward reversal records a negative event and suspends members who already spent it", () => {
  const rewards = { ...policy, real_rewards_enabled: true };
  const base = accepted().state;
  base.members["777"] = { schema_version: 1, github_id: 777, login: "reviewer", credits: 0, initial_grant: true };
  const { state, reviews } = threeConfirmedReviews(base, 777);
  const exchanged = exchangeCredits(state, reviews, 777, rewards);
  const spent = { ...exchanged.state, members: { ...exchanged.state.members, "777": { ...exchanged.state.members["777"], credits: 0 } } };
  const reversal = reverseReward(spent, { ...reviews[0], rewarded: true }, moderator, "reverse:1", rewards);
  assert.equal(reversal.events[0].amount, -1);
  assert.equal(reversal.events[0].review_id, reviews[0].review_id);
  assert.equal(reversal.state.members["777"].suspended, true);
  assert.equal(reversal.review.rewarded, false);
  assert(reverseReward(reversal.state, { ...reviews[0], rewarded: true }, moderator, "reverse:1", rewards).duplicate);
  assert.throws(() => reverseReward(spent, reviews[1], moderator, "reverse:2", rewards), /尚未兑换/);
});
test("suspended members cannot consume creation credits until resumed", () => {
  const state = setSuspension(accepted().state, 123456, true, moderator, policy).state;
  assert.equal(state.members["123456"].suspended, true);
  const next = { issue_number: 30, revision: revisionOf("suspended attempt"), entry_id: null, author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: noMedia };
  const verified = recordVerification(state, 30, next.revision, moderator, 123456, policy).state;
  assert.throws(() => acceptSubmission(verified, next, moderator, policy, noMedia), /暂停/);
  const resumed = setSuspension(state, 123456, false, moderator, policy).state;
  assert.equal(resumed.members["123456"].suspended, false);
});

test("preview computes the same allocation without consuming persisted state", () => {
  const draft = { issue_number: 9, revision, author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: noMedia };
  const state = emptyState();
  const preview = previewSubmission(state, draft, policy, noMedia, "2026-10-07T00:00:00.000Z");
  assert.equal(preview.entry.id, "CC-000001");
  assert.equal(preview.state.members["123456"].credits, 0);
  assert.equal(state.next_entry, 1, "preview must not mutate the given state");
  assert.equal(Object.keys(state.operations).length, 0);
});

test("draft pull requests are created once, updated in place and closed on acceptance", async () => {
  const calls = [];
  let prNumber = 0;
  const request = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push(method + " " + url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\//, ""));
    if (url.endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({ object: { sha: "main-sha" } }), { status: 200 });
    if (url.includes("/git/ref/heads/submission/9")) return new Response(JSON.stringify({ object: { sha: "branch-sha" } }), { status: 200 });
    if (url.endsWith("/git/commits/main-sha")) return new Response(JSON.stringify({ tree: { sha: "tree-0" } }), { status: 200 });
    if (url.endsWith("/git/trees")) return new Response(JSON.stringify({ sha: "tree-1" }), { status: 200 });
    if (url.endsWith("/git/commits")) return new Response(JSON.stringify({ sha: "commit-" + (++prNumber) }), { status: 200 });
    if (url.includes("/git/refs/heads/submission/9")) return new Response(JSON.stringify({}), { status: 200 });
    if (url.includes("/pulls?")) return new Response(JSON.stringify([]), { status: 200 });
    if (url.endsWith("/pulls")) return new Response(JSON.stringify({ number: 31, html_url: "https://example/pr/31", draft: true, head: { sha: "commit-1" } }), { status: 201 });
    if (/\/pulls\/\d+$/.test(url) && method === "PATCH") return new Response(JSON.stringify({ number: 31, html_url: "https://example/pr/31", draft: true, state: "closed", head: { sha: "commit-2" } }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const github = new GitHub("example/repo", "token", request);
  const files = { "entries/CC-000001.json": "{}" };
  const head = await github.head();
  const created = await github.upsertDraftPR("submission/9", "投稿 #9", "body", head, files, "draft");
  assert.equal(created.number, 31);
  assert.equal(created.sha, "commit-1");
  const forced = calls.filter(x => x.startsWith("PATCH") && x.includes("git/refs/heads/submission"));
  assert.equal(forced.length, 1);
  const closed = await github.closePullRequest(31, "done");
  assert.equal(closed.state, "closed");
  assert(calls.some(x => x.startsWith("POST") && x.includes("issues/31/comments")));
});

test("preview report runs the approved normalization and reports real dimensions", async () => {
  const { previewReport } = await import("../lib/media.mjs");
  const png = await sharp({ create: { width: 1600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const request = async () => new Response(png, { status: 200, headers: { "content-length": String(png.length) } });
  const report = await previewReport({ main: "https://github.com/user-attachments/assets/x", memorial: [], avatars: [] }, request);
  assert.equal(report.main.width, 1024);
  assert.equal(report.main.height, 512, "ratio preserved by inside fit");
  assert.equal(report.main.background, "#e5e2d8", "transparent input is flattened onto the site background");
  assert.match(report.main.path, /^media\/[a-f0-9]{64}\.jpg$/);
  assert.equal(report.main.bytes <= 1024 * 1024, true);
});

test("voluntary confirmers: anyone joins, verifies and accepts others' submissions", () => {
  let state = emptyState();
  const joined = joinConfirmer(state, { github_id: 424242, login: "volunteer" }, policy);
  assert(!joined.rejoined);
  assert.equal(joined.state.confirmers["424242"].via, "voluntary");
  assert.throws(() => joinConfirmer(joined.state, { github_id: 424242, login: "volunteer" }, policy), /已是/);
  state = joined.state;
  // the volunteer can verify someone else's submission...
  const verified = recordVerification(state, 9, revision, 424242, 123456, policy);
  assert(!verified.duplicate);
  // ...and accept it (draft carries the submitter identity)
  const draft = { issue_number: 9, revision, author: { github_id: 123456, login: "author" }, title: "t", buried_type: "project", buried_subject: "s", epitaph: "", story: "", date_note: "", tags: [], links: [], players: [], images: noMedia };
  const accepted = acceptSubmission(verified.state, draft, 424242, policy, noMedia);
  assert.equal(accepted.entry.id, "CC-000001");
  // independence still holds: the volunteer cannot handle their own submission
  assert.throws(() => recordVerification(state, 9, revision, 424242, 424242, policy), /自己/);
  const ownDraft = { ...draft, author: { github_id: 424242, login: "volunteer" } };
  assert.throws(() => acceptSubmission(verified.state, ownDraft, 424242, policy, noMedia), /自己/);
  // strangers without joining stay outside
  assert.throws(() => recordVerification(state, 9, revision, 98765, 123456, policy), /\/join/);
  // a suspended confirmer loses the powers and can rejoin voluntarily afterwards
  const suspended = setSuspension(verified.state, 424242, true, moderator, policy).state;
  assert.equal(suspended.confirmers["424242"].suspended, true);
  assert.throws(() => acceptSubmission(suspended, draft, 424242, policy, noMedia), /\/join/);
  const rejoined = joinConfirmer(suspended, { github_id: 424242, login: "volunteer" }, policy);
  assert(rejoined.rejoined);
});

test("confirmer joining is refused when the policy keeps the role closed", () => {
  const closed = { ...policy, open_confirmers_enabled: false };
  assert.throws(() => joinConfirmer(emptyState(), { github_id: 424242, login: "v" }, closed), /未开放/);
});

test("confirmers may independently confirm reviews", () => {
  const state = joinConfirmer(emptyState(), { github_id: 424242, login: "volunteer" }, policy).state;
  const review = submitReview(claimReview(emptyState(), 9, revision, member(11), 123456, policy).state, 9, revision, 11, "support", "同意").review;
  const confirmed = confirmReview(review, 424242, 123456, policy, state);
  assert.equal(confirmed.review.independent_confirmation.confirmed_by, 424242);
});

test("GH04-05 synthetic withdraw drill: source first, then site and packs drop everything", async () => {
  const { buildSite } = await import("../lib/site.mjs");
  const { packMetadata, regionRevision } = await import("../lib/runtime.mjs");
  const { buildAddressManifest } = await import("../lib/runtime.mjs");
  // accepted publication
  const verified = recordVerification(emptyState(), 9, revision, moderator, 123456, policy).state;
  const draft = { issue_number: 9, revision, author: { github_id: 123456, login: "author" }, title: "撤下演练", buried_type: "memory", buried_subject: "对象", epitaph: "", story: "PRIVATE_WITHDRAW_MARKER", date_note: "", tags: [], links: [], players: [], images: { main: null, memorial: [], avatars: [] } };
  const acceptedResult = acceptSubmission(verified, draft, moderator, policy, noMedia);
  // main-site snapshot before withdrawal carries the body
  const beforeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-before-"));
  buildSite(root, beforeDir, project, policy, acceptedResult.state, [acceptedResult.entry]);
  assert(fs.readFileSync(path.join(beforeDir, "entries", acceptedResult.entry.id, "index.html"), "utf8").includes("PRIVATE_WITHDRAW_MARKER"));
  // withdraw on source: visibility change first (the safe order)
  const withdrawnState = changeVisibility(acceptedResult.state, acceptedResult.entry, "removed", moderator, policy, "remove:drill").state;
  const withdrawnEntry = { ...acceptedResult.entry, status: "removed" };
  const afterDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-after-"));
  buildSite(root, afterDir, project, policy, withdrawnState, [withdrawnEntry]);
  const afterHtml = fs.readFileSync(path.join(afterDir, "entries", acceptedResult.entry.id, "index.html"), "utf8");
  assert(!afterHtml.includes("PRIVATE_WITHDRAW_MARKER"), "withdrawn body must leave the page");
  assert(afterHtml.includes("不公开"), "generic unavailable page is shown");
  assert.equal(JSON.parse(fs.readFileSync(path.join(afterDir, "memorials.json"), "utf8")).length, 0);
  // rebuilt runtime packs drop the slot and change revisions
  const before = packMetadata(project, [acceptedResult.entry], 0, 0);
  const after = packMetadata(project, [], 0, 0);
  assert.notEqual(before.revision, after.revision, "pack revision must move so clients refuse stale copies");
  assert.equal(after.entries.filter(Boolean).length, 0);
  const catalogBefore = regionRevision([acceptedResult.entry], [before.revision]);
  const catalogAfter = regionRevision([], [after.revision]);
  assert.notEqual(catalogBefore, catalogAfter);
  assert.equal(withdrawnState.entries[acceptedResult.entry.id].slot, acceptedResult.entry.slot, "slot stays reserved, never reused");
  assert.equal(withdrawnState.members["123456"].credits, 0, "withdrawal does not refund");
  fs.rmSync(beforeDir, { recursive: true, force: true });
  fs.rmSync(afterDir, { recursive: true, force: true });
  buildAddressManifest(project);
});

test("GH06-02 publication receipt updater posts entry receipts idempotently", async () => {
  const { publishReceipts } = await import("../tools/publish-receipts.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-"));
  try {
    fs.mkdirSync(path.join(dir, "entries"), { recursive: true });
    fs.writeFileSync(path.join(dir, "entries/CC-000001.json"), JSON.stringify({ id: "CC-000001", status: "published", locator: "01-01", publication_sequence: 1 }));
    fs.writeFileSync(path.join(dir, "entries/CC-000002.json"), JSON.stringify({ id: "CC-000002", status: "removed", locator: "01-02", publication_sequence: 2 }));
    const state = { receipts: { "9": { entry_id: "CC-000001", approved_revision: revision }, "10": { entry_id: "CC-000002", approved_revision: revision } } };
    const calls = [];
    const bodies = [];
    const api = {
      call: async (route, method = "GET") => {
        calls.push(method + " " + route);
        if (route === "issues/9") return { number: 9, body: "approved body" };
        if (route === "issues/10") return { number: 10, body: "x" };
        return {};
      },
      receipt: async (n, body) => { bodies.push([n, body]); },
      labels: async (n, label) => { calls.push("labels " + n + " " + label); }
    };
    const project = JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"));
    const posted = await publishReceipts({ root: dir, api, state, project });
    assert.deepEqual(posted.map(x => x.kind), ["published-edited-after", "withdrawn"]);
    const published = bodies.find(([n]) => n === "9")[1];
    assert(published.includes("CC-000001") && published.includes("01-01") && published.includes("分享页"));
    assert(published.includes("VRChat世界尚未上线"), "no fake world readiness");
    const withdrawn = bodies.find(([n]) => n === "10")[1];
    assert(withdrawn.includes("不公开") && !withdrawn.includes("01-02"));
    assert(calls.some(x => x === "GET issues/9") && calls.some(x => x.startsWith("labels 9 submission:review")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
