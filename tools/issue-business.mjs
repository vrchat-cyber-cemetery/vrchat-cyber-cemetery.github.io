import fs from "node:fs";
import { GitHub, operationFilename } from "../lib/github.mjs";
import { parseSubmission, revisionOf, emptyState, acceptSubmission, changeVisibility, previewSubmission } from "../lib/submissions.mjs";
import { prepareMedia } from "../lib/media.mjs";
import { recordVerification, claimReview, submitReview, confirmReview, exchangeCredits, compensate, reverseReward, setSuspension } from "../lib/community.mjs";
import { previewReport } from "../lib/media.mjs";

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const repository = process.env.GITHUB_REPOSITORY;
const github = new GitHub(repository, process.env.APP_TOKEN || process.env.GITHUB_TOKEN);
const number = event.issue?.number;
const json = data => JSON.stringify(data, null, 2) + "\n";
const escapeMarkdown = text => String(text).replace(/([\\\u0060*_[\]<>])/g, "\\$1").replace(/@/g, "@\u200b");
const shortRevision = revision => revision.slice(0, 12);
const submissionBranch = issue => "submission/" + issue;

function summary(draft, verification, pull) {
  return "### 投稿已收到\n\n接下来由社区维护者审核。当前尚未公开到网站。\n\n"
    + "- 类型:" + draft.buried_type + "\n- 图片:" + [draft.images.main, ...draft.images.memorial, ...draft.images.avatars].filter(Boolean).length
    + "张\n- 投稿编号:#" + number + "\n- 内容修订:`" + shortRevision(draft.revision) + "`\n\n"
    + "[查看处理进度](https://" + repository.split("/")[0] + ".github.io/status/?issue=" + number + ")\n\n"
    + (pull ? "**结构化草稿 PR:[" + pull.title + "](" + pull.url + ")**(draft)\n\n审核绑定修订 `" + shortRevision(draft.revision) + "` 与 PR 提交 `" + pull.sha.slice(0, 10) + "`;投稿编辑后草稿自动更新,旧绑定失效。\n\n" : "")
    + "<details><summary>维护者审核指令</summary>\n\n1. 核验(人物同意、图片授权、角色权限、利益回避):\n\n    /verify " + draft.revision + "\n\n2. 审核同意后回复(草稿存在时必须附 PR 提交 SHA):\n\n    /publish " + draft.revision + (pull ? " " + pull.sha : "") + "\n\n指令只接受配置中的维护者;不能审核自己的投稿。</details>\n";
}

async function draftFilesFor(state, draft, policy) {
  // Preview the exact acceptance on the current head; nothing lands on main.
  const preview = previewSubmission(state, draft, policy, { main: null, memorial: [], avatars: [] });
  const files = {
    ["entries/" + preview.entry.id + ".json"]: json(preview.entry),
    "data/state.json": json(preview.state),
    ["ledger/" + operationFilename(preview.operation) + ".json"]: json({ operation_id: preview.operation, policy_version: policy.policy_version, issue_number: number, approved_by: null, events: preview.events })
  };
  // Real normalization preview for attached images: same scaling, background and ratio as the approved output.
  const imageList = [draft.images.main, ...draft.images.memorial, ...draft.images.avatars].filter(Boolean);
  if (imageList.length) {
    try {
      const report = await previewReport(draft.images);
      files["previews/" + number + ".json"] = json({ issue_number: number, revision: draft.revision, images: report });
    } catch (error) {
      files["previews/" + number + ".json"] = json({ issue_number: number, revision: draft.revision, error: String(error.message || error) });
    }
  }
  return files;
}

async function upsertDraft(state, draft, policy) {
  try {
    const files = await draftFilesFor(state, draft, policy);
    return await github.upsertDraftPR(
      submissionBranch(number),
      "投稿 #" + number + ":" + draft.title,
      "结构化投稿草稿。预览基于当前 main 计算,接纳时以最新状态重新落地。\n\n- 投稿:#" + number + "\n- 修订:`" + draft.revision + "`\n\n维护者指令见 Issue 回执。此 PR 仅作审核预览,合并无效;接纳由 `/publish` 在 main 上完成。",
      await github.head(), files,
      "Update submission draft for #" + number + " (revision " + shortRevision(draft.revision) + ")"
    );
  } catch (error) {
    // Preview can legitimately fail (no credits left, full cemetery); the receipt explains it.
    return { error: String(error.message || error) };
  }
}

async function intake() {
  const issue = await github.call("issues/" + number);
  if (issue.pull_request) return;
  const head = await github.head();
  const policy = await github.jsonAt("config/policy.json", head.sha);
  if (!policy.automatic_intake_enabled) return;
  if (!issue.body?.includes("### 这里埋葬了什么")) {
    if (issue.body?.includes("### 请求说明")) {
      await github.receipt(number, "### 内容请求已收到\n\n维护者将核验修改、举报、申诉或撤下请求。请在原Issue跟踪,勿上传私密证据。");
      await github.labels(number, "submission:review");
    }
    return;
  }
  try {
    const draft = parseSubmission(issue);
    const current = await github.call("issues/" + number);
    if (revisionOf(current.body) !== draft.revision) return;
    const state = await github.jsonAt("data/state.json", head.sha, emptyState());
    let pull = null;
    if (policy.intake_mode === "app") pull = await upsertDraft(state, draft, policy);
    await github.receipt(number, summary(draft, null, pull?.sha ? pull : null) + (pull?.error && policy.intake_mode === "app" ? "\n> 草稿PR暂未生成:" + escapeMarkdown(pull.error) + "\n" : ""));
    await github.labels(number, "submission:review");
  } catch (error) {
    await github.receipt(number, "### 需要补充信息\n\n" + escapeMarkdown(error.message) + "\n\n请编辑原投稿,保存后会重新校验,无需重复创建Issue。");
    await github.labels(number, "submission:needs-info");
  }
}

async function loadReviews(head, state) {
  const reviews = [];
  for (const n = 1; n < (state.next_review || 1); n++) {
    const id = "RV-" + String(n).padStart(6, "0");
    try { reviews.push(await github.jsonAt("reviews/" + id + ".json", head.sha)); } catch { /* gap in numbering */ }
  }
  return reviews;
}

async function moderate() {
  if (event.comment?.user?.type === "Bot") return;
  const body = String(event.comment?.body || "").trim();
  const publish = /^\/publish ([a-f0-9]{64})(?: ([0-9a-f]{40}))?$/.exec(body);
  const verify = /^\/verify ([a-f0-9]{64})$/.exec(body);
  const reviewClaim = /^\/review claim$/.exec(body);
  const reviewSubmit = /^\/review submit (support|request_changes|reject)\n+([\s\S]+)$/.exec(body);
  const reviewConfirm = /^\/review confirm (RV-\d{6})$/.exec(body);
  const exchange = /^\/exchange$/.exec(body);
  const compensateCmd = /^\/compensate (\d+) (\d+) ([^\n]+)$/.exec(body);
  const revokeCmd = /^\/revoke-review (RV-\d{6})$/.exec(body);
  const suspendCmd = /^\/(suspend|resume) (\d+)$/.exec(body);
  const visibility = /^\/(hide|dispute|remove|restore) (CC-\d{6})$/.exec(body);
  if (!publish && !verify && !reviewClaim && !reviewSubmit && !reviewConfirm && !exchange && !compensateCmd && !revokeCmd && !suspendCmd && !visibility) return;
  let processed = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await github.head();
      const policy = await github.jsonAt("config/policy.json", head.sha);
      if (!policy.automatic_intake_enabled || policy.implementation_status === "not_implemented") return;
      const actorId = event.comment.user.id;
      const actorIsMaintainer = policy.maintainers.some(m => m.github_id === actorId);
      const maintainerOnly = verify || publish || reviewConfirm || compensateCmd || revokeCmd || suspendCmd || visibility;
      if (maintainerOnly && !actorIsMaintainer) return;
      const state = await github.jsonAt("data/state.json", head.sha, emptyState());
      const files = {};
      let result;
      if (verify) {
        const issue = await github.call("issues/" + number);
        const draft = parseSubmission(issue);
        if (draft.revision !== verify[1]) throw new Error("投稿已修改,请对最新修订重新核验。");
        result = recordVerification(state, number, draft.revision, actorId, draft.author.github_id, policy);
        if (!result.duplicate)
          files["ledger/" + operationFilename(result.operation) + ".json"] = json({ operation_id: result.operation, policy_version: policy.policy_version, issue_number: number, revision: draft.revision, checks: result.state.operations[result.operation].checks, verified_by: actorId, timestamp: result.state.operations[result.operation].at });
        files["data/state.json"] = json(result.state);
        await github.commit(head, files, "Record maintainer verification for #" + number);
        await github.receipt(number, "### 核验已记录\n\n人物同意、图片授权、角色权限与利益回避四项检查通过,修订 `" + shortRevision(draft.revision) + "` 可以进入 `/publish`。");
        return;
      }
      if (publish) {
        const issue = await github.call("issues/" + number);
        const draft = parseSubmission(issue);
        if (draft.revision !== publish[1]) throw new Error("投稿已修改,请重新审核最新回执,旧审核指令已失效。");
        if (actorId === draft.author.github_id) throw new Error("请由独立维护者审核,不能自行批准自己的投稿。");
        const pull = policy.intake_mode === "app" ? await github.findPullRequest(submissionBranch(number)) : null;
        if (pull) {
          if (!publish[2]) throw new Error("此投稿存在草稿PR,指令需绑定PR提交SHA:/publish " + draft.revision + " " + pull.head.sha);
          if (publish[2] !== pull.head.sha) throw new Error("草稿PR已更新,绑定的SHA过期;请审核新草稿后使用 /publish " + draft.revision + " " + pull.head.sha);
        }
        if (!processed) processed = await prepareMedia(draft.images);
        const latest = await github.call("issues/" + number);
        if (revisionOf(latest.body) !== draft.revision) throw new Error("处理期间投稿发生修改,请重新审核。");
        result = acceptSubmission(state, draft, actorId, policy, processed.images);
        if (result.duplicate) {
          await github.deploy();
          await github.receipt(number, "### 内容已接纳,正在发布网页\n\n重复执行未再次扣除创建次数。\n\n墓碑ID:" + result.id);
          return;
        }
        Object.assign(files, processed.files);
        files["ledger/" + operationFilename(result.operation) + ".json"] = json({ operation_id: result.operation, policy_version: policy.policy_version, issue_number: number, approved_by: actorId, events: result.events });
        files["entries/" + result.entry.id + ".json"] = json(result.entry);
        files["data/state.json"] = json(result.state);
        try {
          await github.commit(head, files, "Accept community operation for " + result.entry.id);
        } catch (error) {
          if (![409, 422].includes(error.status) || attempt === 2) throw error;
          continue;
        }
        if (pull) await github.closePullRequest(pull.number, "投稿已被接纳并落地 main(修订 `" + shortRevision(draft.revision) + "`)。此草稿仅作审核预览,现在关闭。");
        await github.receipt(number, "### 内容已接纳,正在发布网页\n\n墓碑ID:" + result.entry.id + "\n\n定位码:" + result.entry.locator
          + (pull ? "\n\n审核绑定:修订 `" + shortRevision(draft.revision) + "` · PR提交 `" + publish[2].slice(0, 10) + "`" : "")
          + "\n\n实际部署成功后会补充分享链接。VRChat世界仍在开发,定位码用于预留位置。");
        await github.labels(number, "submission:publishing");
        await github.deploy();
        return;
      }
      if (reviewClaim) {
        const issue = await github.call("issues/" + number);
        const draft = parseSubmission(issue);
        const claim = claimReview(state, number, draft.revision, { github_id: actorId, login: event.comment.user.login }, draft.author.github_id, policy);
        files["data/state.json"] = json(claim.state);
        await github.commit(head, files, "Claim review task for #" + number);
        await github.receipt(number, "### 评审任务已认领\n\n @" + event.comment.user.login.replace(/@/g, "") + " 绑定修订 `" + shortRevision(draft.revision) + "`。提交意见:\n\n    /review submit support|request_changes|reject\n    <具体理由>\n\n经独立确认后计入有效评审;单投稿最多" + policy.max_rewarded_reviews_per_submission + "个奖励任务。");
        return;
      }
      if (reviewSubmit) {
        const issue = await github.call("issues/" + number);
        const draft = parseSubmission(issue);
        const submitted = submitReview(state, number, draft.revision, actorId, reviewSubmit[1], reviewSubmit[2]);
        files["reviews/" + submitted.review.review_id + ".json"] = json(submitted.review);
        files["data/state.json"] = json(submitted.state);
        await github.commit(head, files, "Record review " + submitted.review.review_id + " for #" + number);
        await github.receipt(number, "### 评审已记录 " + submitted.review.review_id + "\n\n立场:" + reviewSubmit[1] + ",绑定修订 `" + shortRevision(draft.revision) + "`。等待维护者独立确认:\n\n    /review confirm " + submitted.review.review_id);
        return;
      }
      if (reviewConfirm) {
        const review = await github.jsonAt("reviews/" + reviewConfirm[1] + ".json", head.sha);
        const issue = await github.call("issues/" + review.submission_issue_number);
        const confirmed = confirmReview(review, actorId, issue.user.id, policy);
        files["reviews/" + review.review_id + ".json"] = json(confirmed.review);
        await github.commit(head, files, "Confirm review " + review.review_id);
        await github.call("issues/" + review.submission_issue_number + "/comments", "POST", { body: "### 评审 " + review.review_id + " 已独立确认\n\n计入有效评审;3次有效评审可兑换1次创建机会(兑换开关按政策开放)。" });
        return;
      }
      if (exchange) {
        const reviews = await loadReviews(head, state);
        result = exchangeCredits(state, reviews, actorId, policy);
        files["allocations/" + result.allocation.allocation_id + ".json"] = json(result.allocation);
        files["ledger/" + operationFilename(result.operation) + ".json"] = json({ operation_id: result.operation, policy_version: policy.policy_version, issue_number: number, approved_by: actorId, events: result.events });
        for (const id of result.consumed) {
          const review = reviews.find(r => r.review_id === id);
          files["reviews/" + id + ".json"] = json({ ...review, rewarded: true });
        }
        files["data/state.json"] = json(result.state);
        await github.commit(head, files, "Exchange confirmed reviews for " + event.comment.user.login);
        await github.receipt(number, "### 兑换完成\n\n" + result.consumed.join("、") + " 共3次有效评审兑换1次创建机会。防重复:同一组评审只能兑换一次。");
        await github.deploy();
        return;
      }
      if (compensateCmd) {
        result = compensate(state, Number(compensateCmd[1]), Number(compensateCmd[2]), compensateCmd[3], actorId, "compensate:" + event.comment.id, policy);
        if (!result.duplicate) {
          files["allocations/" + result.allocation.allocation_id + ".json"] = json(result.allocation);
          files["ledger/" + operationFilename("compensate:" + event.comment.id) + ".json"] = json({ operation_id: "compensate:" + event.comment.id, policy_version: policy.policy_version, issue_number: number, approved_by: actorId, events: result.events });
          files["data/state.json"] = json(result.state);
          await github.commit(head, files, "Record compensation for member " + compensateCmd[1]);
        }
        await github.receipt(number, "### 补偿已记录\n\n成员 " + compensateCmd[1] + " +" + compensateCmd[2] + ":" + escapeMarkdown(compensateCmd[3]));
        return;
      }
      if (revokeCmd) {
        const review = await github.jsonAt("reviews/" + revokeCmd[1] + ".json", head.sha);
        result = reverseReward(state, review, actorId, "reverse:" + event.comment.id, policy);
        if (!result.duplicate) {
          files["reviews/" + review.review_id + ".json"] = json(result.review);
          files["ledger/" + operationFilename("reverse:" + event.comment.id) + ".json"] = json({ operation_id: "reverse:" + event.comment.id, policy_version: policy.policy_version, issue_number: number, approved_by: actorId, events: result.events });
          files["data/state.json"] = json(result.state);
          await github.commit(head, files, "Reverse reward for " + review.review_id);
        }
        await github.receipt(number, "### 奖励已撤销\n\n" + review.review_id + " 不再计入有效评审;" + (result.state.members[String(review.reviewer.github_id)]?.suspended ? "成员余额已消费,新增消费暂停直至补记。" : "余额已扣减。"));
        return;
      }
      if (suspendCmd) {
        result = setSuspension(state, Number(suspendCmd[2]), suspendCmd[1] === "suspend", actorId, policy);
        files["data/state.json"] = json(result.state);
        await github.commit(head, files, (suspendCmd[1] === "suspend" ? "Suspend" : "Resume") + " member " + suspendCmd[2]);
        await github.receipt(number, "### 成员状态更新\n\n成员 " + suspendCmd[2] + (suspendCmd[1] === "suspend" ? " 已暂停新增消费。" : " 已恢复消费。"));
        return;
      }
      // visibility commands (unchanged behavior)
      const id = visibility[2];
      const entry = await github.jsonAt("entries/" + id + ".json", head.sha);
      const status = { hide: "hidden", dispute: "disputed", remove: "removed", restore: "published" }[visibility[1]];
      result = changeVisibility(state, entry, status, actorId, policy, "visibility:" + event.comment.id);
      if (result.duplicate) { await github.deploy(); return; }
      files["ledger/" + operationFilename("visibility:" + event.comment.id) + ".json"] = json({ operation_id: "visibility:" + event.comment.id, entry_id: id, status, approved_by: actorId, timestamp: result.entry.updated_at });
      files["entries/" + result.entry.id + ".json"] = json(result.entry);
      files["data/state.json"] = json(result.state);
      try {
        await github.commit(head, files, "Accept community operation for " + result.entry.id);
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === 2) throw error;
        continue;
      }
      await github.receipt(number, "### 内容状态已更新\n\n" + id + " → " + status);
      await github.labels(number, result.entry.status === "published" ? "submission:publishing" : "submission:withdrawn");
      await github.deploy();
      return;
    }
  } catch (error) {
    await github.call("issues/" + number + "/comments", "POST", { body: "此次操作未完成:" + escapeMarkdown(error.message) + "\n\n没有将此失败操作报告为发布成功;请根据提示修正后重试。" });
    throw error;
  }
}
if (process.env.GITHUB_EVENT_NAME === "issues") await intake();
else if (process.env.GITHUB_EVENT_NAME === "issue_comment") await moderate();
