import fs from "node:fs";
import { GitHub, operationFilename } from "../lib/github.mjs";
import { parseSubmission, revisionOf, emptyState, acceptSubmission, changeVisibility } from "../lib/submissions.mjs";
import { prepareMedia } from "../lib/media.mjs";

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const repository = process.env.GITHUB_REPOSITORY;
const github = new GitHub(repository, process.env.GITHUB_TOKEN);
const number = event.issue?.number;
const json = data => JSON.stringify(data, null, 2) + "\n";
const escapeMarkdown = text => String(text).replace(/([\\\u0060*_[\]<>])/g, "\\$1").replace(/@/g, "@\u200b");
function summary(draft) {
  return "### 投稿已收到\n\n接下来由社区维护者审核。当前尚未公开到网站。\n\n"
    + "- 类型：" + draft.buried_type + "\n- 图片：" + [draft.images.main, ...draft.images.memorial, ...draft.images.avatars].filter(Boolean).length
    + "张\n- 投稿编号：#" + number + "\n\n"
    + "[查看处理进度](https://" + repository.split("/")[0] + ".github.io/status/?issue=" + number + ")\n\n"
    + "<details><summary>维护者审核指令</summary>\n\n审核同意后回复：\n\n"
    + "    /publish " + draft.revision + "\n\n此指令只接受配置中的维护者；不能审核自己的投稿。</details>\n";
}
async function intake() {
  const issue = await github.call("issues/" + number);
  if (issue.pull_request) return;
  const head = await github.head();
  const policy = await github.jsonAt("config/policy.json", head.sha);
  if (!policy.automatic_intake_enabled) return;
  if (!issue.body?.includes("### 这里埋葬了什么")) {
    if (issue.body?.includes("### 请求说明")) {
      await github.receipt(number, "### 内容请求已收到\n\n维护者将核验修改、举报或撤下请求。请在原Issue跟踪，勿上传私密证据。");
      await github.labels(number, "submission:review");
    }
    return;
  }
  try {
    const draft = parseSubmission(issue);
    const current = await github.call("issues/" + number);
    if (revisionOf(current.body) !== draft.revision) return;
    await github.receipt(number, summary(draft));
    await github.labels(number, "submission:review");
  } catch (error) {
    await github.receipt(number, "### 需要补充信息\n\n" + escapeMarkdown(error.message) + "\n\n请编辑原投稿，保存后会重新校验，无需重复创建Issue。");
    await github.labels(number, "submission:needs-info");
  }
}
async function moderate() {
  if (event.comment?.user?.type === "Bot") return;
  const body = String(event.comment?.body || "").trim();
  const publish = /^\/publish ([a-f0-9]{64})$/.exec(body);
  const visibility = /^\/(hide|dispute|remove|restore) (CC-\d{6})$/.exec(body);
  if (!publish && !visibility) return;
  let processed = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await github.head();
      const policy = await github.jsonAt("config/policy.json", head.sha);
      if (!policy.automatic_intake_enabled || policy.implementation_status === "not_implemented") return;
      const actorId = event.comment.user.id;
      if (!policy.maintainers.some(m => m.github_id === actorId)) return;
      const state = await github.jsonAt("data/state.json", head.sha, emptyState());
      const files = {};
      let result;
      if (publish) {
        const issue = await github.call("issues/" + number);
        const draft = parseSubmission(issue);
        if (draft.revision !== publish[1]) throw new Error("投稿已修改，请重新审核最新回执，旧审核指令已失效。");
        if (actorId === draft.author.github_id) throw new Error("请由独立维护者审核，不能自行批准自己的投稿。");
        if (!processed) processed = await prepareMedia(draft.images);
        const latest = await github.call("issues/" + number);
        if (revisionOf(latest.body) !== draft.revision) throw new Error("处理期间投稿发生修改，请重新审核。");
        result = acceptSubmission(state, draft, actorId, policy, processed.images);
        if (result.duplicate) {
          await github.deploy();
          await github.receipt(number, "### 内容已接纳，正在发布网页\n\n重复执行未再次扣除创建次数。\n\n墓碑ID：" + result.id + "\n\n网站部署完成后会补充分享链接与定位码。");
          return;
        }
        Object.assign(files, processed.files);
        files["ledger/" + operationFilename(result.operation) + ".json"] = json({ operation_id: result.operation, policy_version: policy.policy_version, issue_number: number, approved_by: actorId, events: result.events });
      } else {
        const id = visibility[2];
        const entry = await github.jsonAt("entries/" + id + ".json", head.sha);
        const status = { hide: "hidden", dispute: "disputed", remove: "removed", restore: "published" }[visibility[1]];
        result = changeVisibility(state, entry, status, actorId, policy, "visibility:" + event.comment.id);
        if (result.duplicate) { await github.deploy(); return; }
        files["ledger/" + operationFilename("visibility:" + event.comment.id) + ".json"] = json({ operation_id: "visibility:" + event.comment.id, entry_id: id, status, approved_by: actorId, timestamp: result.entry.updated_at });
      }
      files["entries/" + result.entry.id + ".json"] = json(result.entry);
      files["data/state.json"] = json(result.state);
      try {
        await github.commit(head, files, "Accept community operation for " + result.entry.id);
        await github.receipt(number, "### 内容已接纳，正在发布网页\n\n墓碑ID：" + result.entry.id + "\n\n定位码：" + result.entry.locator
          + "\n\n实际部署成功后会补充分享链接。VRChat世界仍在开发，定位码用于预留位置。");
        await github.labels(number, result.entry.status === "published" ? "submission:publishing" : "submission:withdrawn");
        await github.deploy();
        return;
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === 2) throw error;
      }
    }
  } catch (error) {
    await github.call("issues/" + number + "/comments", "POST", { body: "此次操作未完成：" + escapeMarkdown(error.message) + "\n\n没有将此失败操作报告为发布成功；请根据提示修正后重试。" });
    throw error;
  }
}
if (process.env.GITHUB_EVENT_NAME === "issues") await intake();
else if (process.env.GITHUB_EVENT_NAME === "issue_comment") await moderate();
