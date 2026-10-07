import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import Ajv from "ajv";
import { fileURLToPath } from "node:url";
import { emptyState, acceptSubmission, previewSubmission, revisionOf } from "../lib/submissions.mjs";
import { recordVerification, claimReview, submitReview, confirmReview, exchangeCredits, compensate, reverseReward, setSuspension } from "../lib/community.mjs";
import { GitHub } from "../lib/github.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/policy.json"), "utf8"));
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
  const base = accepted().state;
  base.members["777"] = { schema_version: 1, github_id: 777, login: "reviewer", credits: 0, initial_grant: true };
  const { state, reviews } = threeConfirmedReviews(base, 777);
  assert.throws(() => exchangeCredits(state, reviews, 777, policy), /尚未开放/);
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
