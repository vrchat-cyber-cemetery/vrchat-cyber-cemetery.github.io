import crypto from "node:crypto";

// Community operations beyond plain acceptance: maintainer verification, review tasks,
// independent confirmation, credit exchange, compensation, reward reversal and suspension.
// All transitions are pure state functions; the workflow layer commits them.

const maintainersOnly = (policy, actor) => {
  if (!policy.maintainers.some(m => m.github_id === actor)) throw new Error("只有维护者可以执行此操作。");
};

// Independent confirmers join voluntarily; they carry the same independence duty
// (never confirm their own submission) without needing an invitation or org membership.
export function joinConfirmer(state, user, policy, timestamp = new Date().toISOString()) {
  if (!policy.open_confirmers_enabled) throw new Error("独立确认人加入当前未开放。");
  const next = structuredClone(state);
  next.confirmers ||= {};
  const key = String(user.github_id);
  if (next.confirmers[key]) {
    if (!next.confirmers[key].suspended) throw new Error("已是独立确认人。");
    next.confirmers[key].suspended = false;
    next.confirmers[key].rejoined_at = timestamp;
    return { state: next, rejoined: true };
  }
  next.confirmers[key] = { schema_version: 1, github_id: user.github_id, login: user.login, joined_at: timestamp, via: "voluntary", suspended: false };
  return { state: next, rejoined: false };
}

export function isConfirmer(state, githubId) {
  const record = state.confirmers?.[String(githubId)];
  return Boolean(record && !record.suspended);
}

const confirmersAllowed = (policy, state, actor) =>
  policy.maintainers.some(m => m.github_id === actor) || (policy.open_confirmers_enabled && isConfirmer(state, actor));

const confirmerOnly = (policy, state, actor) => {
  if (!confirmersAllowed(policy, state, actor)) throw new Error("只有维护者或独立确认人可以执行此操作;回复 /join 可自愿加入。");
};

export const verifyOperationId = (issueNumber, revision) => "verify:" + issueNumber + ":" + revision;

export function recordVerification(state, issueNumber, revision, actor, submitterId, policy, timestamp = new Date().toISOString()) {
  confirmerOnly(policy, state, actor);
  if (actor === submitterId) throw new Error("不能核验自己的投稿。");
  const next = structuredClone(state);
  const operation = verifyOperationId(issueNumber, revision);
  if (next.operations[operation]) return { state: next, duplicate: true, operation };
  next.operations[operation] = {
    verified_by: actor, at: timestamp,
    checks: { consent: true, rights: true, roles: true, conflict: true }
  };
  return { state: next, duplicate: false, operation };
}

export function verificationFor(state, issueNumber, revision) {
  return state.operations[verifyOperationId(issueNumber, revision)] || null;
}

function tasksOf(state, issueNumber) {
  state.review_tasks ||= {};
  return state.review_tasks[String(issueNumber)] ||= [];
}

export function claimReview(state, issueNumber, revision, reviewer, submitterId, policy, timestamp = new Date().toISOString()) {
  const next = structuredClone(state);
  const tasks = tasksOf(next, issueNumber);
  if (reviewer.github_id === submitterId) throw new Error("不能认领自己的投稿。");
  if (tasks.some(t => t.reviewer_id === reviewer.github_id && t.status === "open"))
    throw new Error("已认领此投稿的评审任务,请直接提交意见。");
  if (tasks.filter(t => t.status !== "cancelled").length >= policy.max_rewarded_reviews_per_submission)
    throw new Error("此投稿的评审任务已满,最多" + policy.max_rewarded_reviews_per_submission + "个。");
  const task = { reviewer_id: reviewer.github_id, login: reviewer.login, revision, claimed_at: timestamp, status: "open" };
  tasks.push(task);
  return { state: next, task };
}

export function submitReview(state, issueNumber, currentRevision, reviewerId, position, statement, timestamp = new Date().toISOString()) {
  if (!["support", "request_changes", "reject"].includes(position)) throw new Error("评审立场为 support、request_changes 或 reject。");
  const text = String(statement || "").trim();
  if (!text || text.length > 4000) throw new Error("评审说明需为1~4000字符,赞成、要求修改和拒绝使用同一质量标准。");
  const next = structuredClone(state);
  const tasks = tasksOf(next, issueNumber);
  const task = tasks.find(t => t.reviewer_id === reviewerId && t.status === "open");
  if (!task) throw new Error("请先认领此投稿的评审任务。");
  if (task.revision !== currentRevision) throw new Error("投稿已修改,旧评审任务失效,请重新认领。");
  const id = "RV-" + String(next.next_review = (next.next_review || 1)).padStart(6, "0");
  next.next_review++;
  task.status = "submitted";
  const review = {
    schema_version: 1, review_id: id, submission_issue_number: Number(issueNumber),
    reviewed_revision: task.revision,
    reviewer: { github_id: task.reviewer_id, login: task.login },
    position, statement: text, conflict_of_interest: false,
    independent_confirmation: null, rewarded: false, submitted_at: timestamp
  };
  return { state: next, review };
}

export function confirmReview(review, confirmerId, submitterId, policy, state = {}, timestamp = new Date().toISOString()) {
  confirmerOnly(policy, state, confirmerId);
  if (confirmerId === review.reviewer.github_id) throw new Error("不能确认自己提交的评审。");
  if (confirmerId === submitterId) throw new Error("投稿作者不能确认评审。");
  if (review.independent_confirmation) return { review, duplicate: true };
  return { review: { ...review, independent_confirmation: { confirmed_by: confirmerId, confirmed_at: timestamp } }, duplicate: false };
}

export function countableReviews(reviews, memberId) {
  return reviews.filter(r => r.reviewer.github_id === memberId
    && r.independent_confirmation && !r.conflict_of_interest && !r.rewarded && r.valid !== false);
}

export function exchangeCredits(state, reviews, memberId, policy, timestamp = new Date().toISOString()) {
  const next = structuredClone(state);
  const member = next.members[String(memberId)];
  if (!member) throw new Error("成员尚未注册。");
  if (member.suspended) throw new Error("成员消费已暂停,不能兑换。");
  if (!policy.real_rewards_enabled) throw new Error("评审兑换尚未开放:真实奖励需要第二位独立维护者就绪后启用。");
  const eligible = countableReviews(reviews, memberId);
  if (eligible.length < policy.valid_reviews_per_credit)
    throw new Error("有效评审不足:已确认" + eligible.length + "/" + policy.valid_reviews_per_credit + "。");
  const consumed = eligible.slice(0, policy.valid_reviews_per_credit).map(r => r.review_id).sort();
  const operation = "exchange:" + memberId + ":" + consumed.join(",");
  if (next.operations[operation]) throw new Error("这组评审已兑换过,不能重复兑换。");
  const allocationId = "AL-" + String(next.next_allocation = (next.next_allocation || 1)).padStart(6, "0");
  next.next_allocation++;
  member.credits += 1;
  next.operations[operation] = allocationId;
  const allocation = {
    schema_version: 1, allocation_id: allocationId, member_id: memberId, amount: 1,
    reason: "review-exchange", evidence: consumed, granted_at: timestamp, operation_id: operation
  };
  const event = { operation_id: operation, kind: "review-exchange", member_id: memberId, amount: 1, entry_id: null, review_id: null, timestamp };
  return { state: next, operation, allocation, events: [event], consumed };
}

export function compensate(state, memberId, amount, evidence, actor, operation, policy, timestamp = new Date().toISOString()) {
  maintainersOnly(policy, actor);
  if (!Number.isInteger(amount) || amount < 1) throw new Error("补偿数量需为正整数。");
  const next = structuredClone(state);
  const member = next.members[String(memberId)];
  if (!member) throw new Error("成员尚未注册。");
  if (next.operations[operation]) return { state: next, duplicate: true };
  const allocationId = "AL-" + String(next.next_allocation = (next.next_allocation || 1)).padStart(6, "0");
  next.next_allocation++;
  member.credits += amount;
  next.operations[operation] = allocationId;
  const allocation = {
    schema_version: 1, allocation_id: allocationId, member_id: memberId, amount,
    reason: "compensation", evidence: [String(evidence || "").slice(0, 200)], granted_at: timestamp, operation_id: operation
  };
  const event = { operation_id: operation, kind: "compensation", member_id: memberId, amount, entry_id: null, review_id: null, timestamp };
  return { state: next, duplicate: false, allocation, events: [event] };
}

export function reverseReward(state, review, actor, operation, policy, timestamp = new Date().toISOString()) {
  maintainersOnly(policy, actor);
  if (!review.rewarded) throw new Error("此评审尚未兑换奖励,无需撤销。");
  const next = structuredClone(state);
  if (next.operations[operation]) return { state: next, duplicate: true };
  const member = next.members[String(review.reviewer.github_id)];
  if (!member) throw new Error("成员尚未注册。");
  if (member.credits >= 1) member.credits -= 1;
  else member.suspended = true; // reward already spent: freeze new spending until the ledger is settled
  next.operations[operation] = review.review_id;
  const event = {
    operation_id: operation, kind: "compensation", member_id: review.reviewer.github_id, amount: -1,
    entry_id: null, review_id: review.review_id, timestamp
  };
  return { state: next, duplicate: false, review: { ...review, rewarded: false, valid: false }, events: [event] };
}

export function setSuspension(state, memberId, suspended, actor, policy) {
  maintainersOnly(policy, actor);
  const next = structuredClone(state);
  const member = next.members[String(memberId)];
  if (member) member.suspended = Boolean(suspended);
  const confirmer = (next.confirmers ||= {})[String(memberId)];
  if (confirmer) confirmer.suspended = Boolean(suspended);
  if (!member && !confirmer) throw new Error("成员尚未注册。");
  return { state: next };
}

export const operationFilename = operation => crypto.createHash("sha256").update(operation).digest("hex");
