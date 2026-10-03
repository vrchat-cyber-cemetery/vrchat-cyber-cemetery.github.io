import crypto from "node:crypto";

export const TYPES = [
  ["person", "人物"], ["identity", "网络身份"], ["relationship", "一段关系"],
  ["memory", "一段记忆"], ["community", "一个社区"], ["project", "项目或世界"],
  ["event", "事件或时代"], ["concept", "抽象事物"], ["other", "其他"]
];
export const TYPE_LABELS = Object.fromEntries(TYPES);
export const FIELD_LABELS = {
  subject: "这里埋葬了什么", buried_type: "对象类型", title: "自定义标题",
  epitaph: "墓志铭", story: "故事", date_note: "日期与含义", tags: "标签",
  links: "相关链接", players: "相关玩家", main_image: "主图",
  memorial_images: "纪念图片", player_avatars: "玩家头像", consent: "公开与授权",
  entry_id: "墓碑 ID", reason: "请求说明"
};
export function revisionOf(body) {
  return crypto.createHash("sha256").update(body || "", "utf8").digest("hex");
}
export function sectionsOf(body) {
  const sections = {};
  // Split only at actual form headings. Stories may contain other Markdown headings.
  const lines = String(body || "").split(/\r?\n/);
  let key = null, buffer = [];
  const known = new Set(Object.values(FIELD_LABELS));
  function flush() {
    if (!key) return;
    if (Object.hasOwn(sections, key)) throw new Error("同一表单字段重复出现，请保留一份并将故事中的同名标题改写。");
    const value = buffer.join("\n").trim();
    sections[key] = value === "_No response_" ? "" : value;
  }
  for (const line of lines) {
    const match = /^### ([^\r\n]+)$/.exec(line);
    if (match && known.has(match[1])) { flush(); key = match[1]; buffer = []; }
    else if (key) buffer.push(line);
  }
  flush();
  return sections;
}
function trimField(value, limit, label) {
  const text = String(value || "").trim();
  if (text.length > limit) throw new Error(label + "过长，最多" + limit + "个字符。");
  return text;
}
export function attachmentUrls(value) {
  const urls = [...String(value || "").matchAll(/https:\/\/[^\s<>)"']+/g)].map(m => m[0]);
  return [...new Set(urls)].map(url => {
    const parsed = new URL(url);
    const allowed = (parsed.hostname === "github.com" && /^\/user-attachments\/assets\/[a-z0-9-]+$/i.test(parsed.pathname))
      || (parsed.hostname === "user-images.githubusercontent.com" && /^\/\d+\//.test(parsed.pathname));
    if (!allowed || parsed.username || parsed.password) throw new Error("图片请直接拖入GitHub附件区，不支持外部网站图片链接。");
    return parsed.href;
  });
}
export function parseSubmission(issue) {
  const s = sectionsOf(issue.body);
  const subject = trimField(s[FIELD_LABELS.subject], 240, "埋葬对象");
  if (!subject) throw new Error("请填写“这里埋葬了什么”。");
  const rawType = s[FIELD_LABELS.buried_type] || "";
  const type = TYPES.find(([id, name]) => rawType === id || rawType === name || rawType.includes("（" + id + "）"))?.[0];
  if (!type) throw new Error("请选择九种对象类型中的一种。");
  const declarations = s[FIELD_LABELS.consent] || "";
  const checks = [...declarations.matchAll(/^- \[[xX]\] (.+)$/gm)].map(m => m[1]);
  if (!checks.some(x => x.includes("公开")) || !checks.some(x => x.includes("授权"))
    || !checks.some(x => x.includes("同意"))) throw new Error("请确认公开、图片授权和涉及他人的同意声明。");
  const players = (s[FIELD_LABELS.players] || "").split("\n").map(x => x.trim()).filter(Boolean).map(line => {
    const [display_name, profile_url = ""] = line.split("|").map(x => x.trim());
    if (!display_name || display_name.length > 80) throw new Error("每位相关玩家的展示名需为1～80字符。");
    if (profile_url && !/^https:\/\/vrchat\.com\/home\/user\/usr_[a-z0-9-]+$/i.test(profile_url)) throw new Error("玩家链接请使用VRChat公开个人资料链接，或留空。");
    return { display_name, profile_url: profile_url || null };
  });
  if (players.length > 3) throw new Error("最多关联三名玩家，每行一位。");
  const main = attachmentUrls(s[FIELD_LABELS.main_image]);
  const memorial = attachmentUrls(s[FIELD_LABELS.memorial_images]);
  const avatars = attachmentUrls(s[FIELD_LABELS.player_avatars]);
  if (main.length > 1 || memorial.length > 3 || avatars.length > players.length) throw new Error("最多1张主图、3张纪念图、每位相关玩家1张头像。");
  const tags = (s[FIELD_LABELS.tags] || "").split(/[,，]/).map(x => x.trim()).filter(Boolean);
  if (tags.length > 8 || tags.some(x => x.length > 24)) throw new Error("标签最多8个，每个最多24字符。");
  const links = (s[FIELD_LABELS.links] || "").split("\n").map(x => x.trim()).filter(Boolean);
  if (links.length > 8 || links.some(x => !/^https?:\/\/\S+$/.test(x))) throw new Error("相关链接请每行一个http或https地址，最多8个。");
  const target = (s[FIELD_LABELS.entry_id] || "").trim();
  if (target && !/^CC-\d{6}$/.test(target)) throw new Error("墓碑ID格式为CC-000001。");
  return {
    title: trimField(s[FIELD_LABELS.title] || "这里埋葬了" + subject, 240, "标题"),
    buried_type: type, buried_subject: subject,
    epitaph: trimField(s[FIELD_LABELS.epitaph], 500, "墓志铭"),
    story: trimField(s[FIELD_LABELS.story], 4000, "故事"),
    date_note: trimField(s[FIELD_LABELS.date_note], 500, "日期说明"),
    tags, links, players, images: { main: main[0] || null, memorial, avatars },
    consent: { public: true, rights: true, persons: true },
    entry_id: target || null, revision: revisionOf(issue.body),
    author: { github_id: issue.user.id, login: issue.user.login },
    issue_number: issue.number
  };
}
export function locatorOf(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 4096) throw new Error("墓位超出容量。");
  return String(Math.floor(slot / 64) + 1).padStart(2, "0") + "-" + String(slot % 64 + 1).padStart(2, "0");
}
export function parseLocator(code) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(code).replace(/\s/g, ""));
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 64 || Number(match[2]) < 1 || Number(match[2]) > 64) throw new Error("定位码示例12-34，两段均为01～64。");
  return (Number(match[1]) - 1) * 64 + Number(match[2]) - 1;
}
export function emptyState() {
  return { schema_version: 1, publication_sequence: 0, next_entry: 1, entries: {}, members: {}, operations: {}, receipts: {} };
}
export function acceptSubmission(state, draft, actorId, policy, media, now = new Date().toISOString()) {
  if (!policy.maintainers.some(m => m.github_id === actorId)) throw new Error("只有维护者可以发布。");
  if (actorId === draft.author.github_id) throw new Error("维护者不能审核自己的投稿，请由独立维护者确认。");
  const next = structuredClone(state);
  const op = "publish:" + draft.issue_number + ":" + draft.revision;
  if (next.operations[op]) return { state: next, entry: null, duplicate: true, id: next.operations[op] };
  const previous = Object.values(next.entries).find(x => x.issue_number === draft.issue_number);
  if (previous && !draft.entry_id) throw new Error("此投稿已发布，请用修改表单提交新请求。");
  const editing = draft.entry_id ? next.entries[draft.entry_id] : null;
  if (draft.entry_id && !editing) throw new Error("目标墓碑不存在。");
  if (editing?.creator_id === actorId) throw new Error("请由独立维护者确认这次修改。");
  let id, slot;
  const events = [];
  if (editing) { id = editing.id; slot = editing.slot; }
  else {
    const key = String(draft.author.github_id);
    let member = next.members[key];
    if (!member) {
      member = next.members[key] = { github_id: draft.author.github_id, login: draft.author.login, credits: policy.initial_creation_credits, initial_grant: true };
      events.push({ kind: "initial-grant", member_id: draft.author.github_id, amount: policy.initial_creation_credits });
    }
    if (member.credits < 1) throw new Error("当前没有剩余创建次数；可以先参与社区评审。");
    const occupied = new Set(Object.values(next.entries).map(x => x.slot));
    slot = Array.from({ length: 4096 }, (_, i) => i).find(x => !occupied.has(x));
    if (slot === undefined) throw new Error("墓园预留位置已满，本次没有扣除次数。");
    id = "CC-" + String(next.next_entry++).padStart(6, "0");
    member.credits--;
    events.push({ kind: "creation-consume", member_id: draft.author.github_id, amount: -1, entry_id: id });
  }
  next.publication_sequence++;
  const entry = {
    schema_version: 1, id, status: "published", title: draft.title,
    buried_type: draft.buried_type, buried_subject: draft.buried_subject,
    epitaph: draft.epitaph, story: draft.story, date_note: draft.date_note,
    tags: draft.tags, links: draft.links, players: draft.players,
    images: media, slot, locator: locatorOf(slot),
    creator_id: editing?.creator_id || draft.author.github_id,
    creator_login: editing?.creator_login || draft.author.login,
    issue_number: editing?.issue_number || draft.issue_number,
    request_issue_number: draft.issue_number,
    approved_revision: draft.revision, approved_by: actorId,
    updated_at: now, publication_sequence: next.publication_sequence,
    world_status: "awaiting_world"
  };
  next.entries[id] = { id, slot, status: entry.status, creator_id: entry.creator_id, creator_login: entry.creator_login, issue_number: entry.issue_number };
  next.operations[op] = id;
  next.receipts ||= {};
  next.receipts[String(draft.issue_number)] = { entry_id: id, approved_revision: draft.revision };
  return { state: next, entry, duplicate: false, events: events.map(e => ({ ...e, operation_id: op, timestamp: now })), operation: op };
}
export function changeVisibility(state, entry, status, actorId, policy, operation, now = new Date().toISOString()) {
  if (!policy.maintainers.some(m => m.github_id === actorId)) throw new Error("只有维护者可以改变公开状态。");
  if (!["hidden", "disputed", "removed", "published"].includes(status)) throw new Error("状态无效。");
  if (status === "published" && entry.creator_id === actorId) throw new Error("恢复需要独立维护者审核。");
  const next = structuredClone(state);
  if (next.operations[operation]) return { state: next, duplicate: true };
  next.publication_sequence++;
  next.entries[entry.id].status = status;
  next.operations[operation] = entry.id;
  return { state: next, duplicate: false, entry: { ...entry, status, updated_at: now, publication_sequence: next.publication_sequence } };
}
