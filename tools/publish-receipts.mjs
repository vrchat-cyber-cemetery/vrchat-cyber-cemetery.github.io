import fs from "node:fs";
import path from "node:path";
import { GitHub } from "../lib/github.mjs";
import { revisionOf } from "../lib/submissions.mjs";
import { fileURLToPath } from "node:url";

// Posts the fixed publication receipt for every tracked issue. Invoked by the Pages
// workflow after deployment; idempotent because it always rewrites the same receipt.
export async function publishReceipts({ root, api, state, project }) {
  const posted = [];
  for (const [issueNumber, record] of Object.entries(state.receipts || {})) {
    const entry = JSON.parse(fs.readFileSync(path.join(root, "entries", record.entry_id + ".json"), "utf8"));
    const issue = await api.call("issues/" + issueNumber);
    if (entry.status !== "published") {
      await api.receipt(issueNumber, "### 内容当前不公开\n\n分享页已更新为通用不可用提示，当前正文与图片不在网站展示。请在原Issue联系维护者。");
      await api.labels(issueNumber, "submission:withdrawn");
      posted.push({ issue: Number(issueNumber), kind: "withdrawn" });
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
    posted.push({ issue: Number(issueNumber), kind: changed ? "published-edited-after" : "published" });
  }
  return posted;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await publishReceipts({
    root,
    api: new GitHub(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN),
    state: JSON.parse(fs.readFileSync(path.join(root, "data/state.json"), "utf8")),
    project: JSON.parse(fs.readFileSync(path.join(root, "config/project.json"), "utf8"))
  });
}
