import fs from "node:fs";
import { GitHub } from "../lib/github.mjs";
import { revisionOf } from "../lib/submissions.mjs";
const state = JSON.parse(fs.readFileSync("data/state.json", "utf8"));
const project = JSON.parse(fs.readFileSync("config/project.json", "utf8"));
const api = new GitHub(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
for (const [issueNumber, record] of Object.entries(state.receipts || {})) {
  const entry = JSON.parse(fs.readFileSync("entries/" + record.entry_id + ".json", "utf8"));
  const issue = await api.call("issues/" + issueNumber);
  if (entry.status !== "published") {
    await api.receipt(issueNumber, "### 内容当前不公开\n\n分享页已更新为通用不可用提示，当前正文与图片不在网站展示。请在原Issue联系维护者。");
    await api.labels(issueNumber, "submission:withdrawn");
    continue;
  }
  const changed = revisionOf(issue.body) !== record.approved_revision;
  const url = project.site_base + "/entries/" + entry.id + "/";
  await api.receipt(issueNumber, "### 已批准版本的网页已发布\n\n"
    + "- 墓碑ID：" + entry.id + "\n- 定位码：**" + entry.locator + "**\n- 发布版本：" + entry.publication_sequence
    + "\n\n[打开分享页](" + url + ") · [查看定位说明](" + project.site_base + "/find/?code=" + entry.locator + ")\n\n"
    + (changed ? "**原投稿后来有修改，修改内容仍待审核。** 当前分享页只显示已批准版本。\n\n" : "")
    + (project.publication.vrchat_world_id
      ? "[进入VRChat世界](https://vrchat.com/home/world/" + project.publication.vrchat_world_id + ")\n\n进入世界后，在入口输入定位码并确认标题。"
      : "**VRChat世界尚未上线。** 当前可以阅读和分享网页，定位码已为未来世界预留；不会将网页发布误报为世界已可参观。"));
  await api.labels(issueNumber, changed ? "submission:review" : "submission:published");
}
