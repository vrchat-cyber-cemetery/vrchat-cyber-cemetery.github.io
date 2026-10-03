const config = await fetch("/assets/site-config.json").then(r => r.json());
const typeLabels = { person: "人物", identity: "网络身份", relationship: "一段关系", memory: "一段记忆", community: "一个社区", project: "项目或世界", event: "事件或时代", concept: "抽象事物", other: "其他" };
const fieldLabels = { subject: "这里埋葬了什么", buried_type: "对象类型", title: "自定义标题", epitaph: "墓志铭", story: "故事", date_note: "日期与含义", tags: "标签", links: "相关链接", players: "相关玩家" };
const value = id => document.getElementById(id)?.value.trim() || "";
function toast(text) {
  const box = document.createElement("div"); box.className = "toast"; box.setAttribute("role", "status"); box.textContent = text; document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}
function result(container, title, paragraphs, link) {
  container.replaceChildren();
  const section = document.createElement("section"); section.className = "result";
  const h = document.createElement("h2"); h.textContent = title; section.append(h);
  for (const text of paragraphs) { const p = document.createElement("p"); p.textContent = text; section.append(p); }
  if (link) { const a = document.createElement("a"); a.className = "text-link"; a.href = link.href; a.textContent = link.text; section.append(a); }
  container.append(section);
}
const form = document.getElementById("memorial-form");
if (form) {
  let step = 1;
  const error = document.getElementById("form-error");
  function setStep(next) {
    if (next > 1 && !value("subject")) { error.textContent = "先写下你想纪念的事物。"; document.getElementById("subject").focus(); return; }
    error.textContent = ""; step = next;
    document.querySelectorAll("[data-panel]").forEach(x => { x.hidden = Number(x.dataset.panel) !== step; });
    document.querySelectorAll("[data-step]").forEach(x => { if (Number(x.dataset.step) === step) x.setAttribute("aria-current", "step"); else x.removeAttribute("aria-current"); });
    if (step === 3) prepareTransfer();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.querySelectorAll("[data-next],[data-prev],[data-step]").forEach(button => button.addEventListener("click", () => setStep(Number(button.dataset.next || button.dataset.prev || button.dataset.step))));
  function draft() {
    return Object.entries(fieldLabels).map(([id, label]) => "### " + label + "\n\n" + (id === "buried_type" ? typeLabels[value(id)] + "（" + value(id) + "）" : value(id) || "_No response_")).join("\n\n")
      + "\n\n### 主图\n\n_No response_\n\n### 纪念图片\n\n_No response_\n\n### 玩家头像\n\n_No response_\n\n### 公开与授权\n\n"
      + ["我理解投稿、图片和Git历史会公开。", "我具备文字和图片使用授权。", "涉及他人时已取得同意，不捏造死亡或公开隐私。"].map((text, i) => "- [" + (document.getElementById(["consent-public", "consent-rights", "consent-persons"][i]).checked ? "x" : " ") + "] " + text).join("\n");
  }
  function prepareTransfer() {
    const url = new URL("https://github.com/" + config.repository + "/issues/new");
    url.searchParams.set("template", "memorial.yml");
    url.searchParams.set("title", "[墓碑投稿] " + (value("title") || value("subject")).slice(0, 100));
    url.searchParams.set("buried_type", typeLabels[value("buried_type")]);
    for (const id of Object.keys(fieldLabels)) if (id !== "buried_type" && value(id)) url.searchParams.set(id, value(id));
    const skipped = [];
    for (const id of ["story", "links", "players", "epitaph"]) {
      if (url.href.length <= 6500) break;
      if (url.searchParams.has(id)) { url.searchParams.delete(id); skipped.push(fieldLabels[id]); }
    }
    const note = document.getElementById("transfer-note");
    note.hidden = skipped.length === 0;
    note.textContent = skipped.length ? "这些内容较长，无法安全带入链接：" + skipped.join("、") + "。请用下方“复制完整投稿草稿”保存内容，打开GitHub后将对应段落补入。" : "";
    document.getElementById("draft-text").value = draft();
    return url.href;
  }
  form.addEventListener("input", () => {
    document.getElementById("preview-subject").textContent = value("subject") || "一份值得记住的事物";
    document.getElementById("preview-epitaph").textContent = value("epitaph") || "你留下的话，会在这里。";
    document.getElementById("preview-type").textContent = typeLabels[value("buried_type")];
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!value("subject")) { setStep(1); return; }
    if (!["consent-public", "consent-rights", "consent-persons"].every(id => document.getElementById(id).checked)) { error.textContent = "请逐项确认公开、授权和涉及他人的同意声明。"; return; }
    error.textContent = "";
    location.href = prepareTransfer();
  });
  document.getElementById("copy-draft").addEventListener("click", async () => {
    const textarea = document.getElementById("draft-text"); textarea.value = draft();
    try { await navigator.clipboard.writeText(textarea.value); toast("完整草稿已复制；请在GitHub核对类型、授权并添加图片。"); }
    catch { textarea.hidden = false; textarea.focus(); textarea.select(); toast("请选择并复制下方完整草稿。"); }
  });
  const imageUrls = [];
  document.getElementById("preview-files").addEventListener("change", event => {
    imageUrls.forEach(URL.revokeObjectURL); imageUrls.length = 0;
    const files = [...event.target.files];
    const preview = document.getElementById("image-previews"); preview.replaceChildren();
    if (files.length > 7 || files.some(f => f.size > 16 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(f.type))) {
      error.textContent = "最多预览7张静态JPG、PNG或WebP，单张不超过16MB。"; event.target.value = ""; return;
    }
    error.textContent = "";
    for (const file of files) {
      const url = URL.createObjectURL(file); imageUrls.push(url);
      const figure = document.createElement("figure"), img = document.createElement("img"), caption = document.createElement("figcaption");
      img.src = url; img.alt = "本地预览"; caption.textContent = file.name; figure.append(img, caption); preview.append(figure);
    }
  });
}
const statusForm = document.getElementById("status-form");
if (statusForm) {
  const input = document.getElementById("issue-number"), box = document.getElementById("status-result");
  const params = new URLSearchParams(location.search); input.value = params.get("issue") || "";
  statusForm.addEventListener("submit", async event => {
    event.preventDefault();
    const raw = input.value.trim();
    let number = raw.replace(/^#/, "");
    if (raw.startsWith("https://")) {
      try { const u = new URL(raw); const prefix = "/" + config.repository + "/issues/"; if (u.hostname !== "github.com" || !u.pathname.startsWith(prefix)) throw new Error(); number = u.pathname.slice(prefix.length); }
      catch { result(box, "请使用本项目的投稿编号", ["输入例如123，或本项目的GitHub Issue链接。"]); return; }
    }
    if (!/^[1-9]\d{0,8}$/.test(number)) { result(box, "投稿编号格式有误", ["输入例如123，或本项目的GitHub Issue链接。"]); return; }
    const button = statusForm.querySelector("button"); button.disabled = true;
    result(box, "正在读取公开进度", ["请稍等。"]);
    try {
      const r = await fetch("https://api.github.com/repos/" + config.repository + "/issues/" + number, { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(r.status === 404 ? "没有找到这份投稿，请核对编号。" : "GitHub读取暂不可用，可能已达到公开查询限制，请直接打开投稿查看。");
      const issue = await r.json();
      if (issue.pull_request) throw new Error("这个编号是代码PR，请使用墓碑投稿的Issue编号。");
      const names = issue.labels.map(x => x.name);
      const key = names.find(x => x.startsWith("submission:"));
      const statuses = {
        "submission:review": ["等待社区审核", "已完成基本校验，请在原投稿等待审核或补充信息。"],
        "submission:needs-info": ["需要补充信息", "请打开原投稿，按自动回执提示编辑内容，保存后会重新校验。"],
        "submission:publishing": ["已接纳，网页正在发布", "部署完成后，原投稿会出现分享链接和定位码。"],
        "submission:published": ["网页已发布", "打开原投稿查看分享页与定位码。VRChat世界仍在建设，网页发布不等于世界可参观。"],
        "submission:withdrawn": ["内容当前不公开", "请在原投稿查看处理记录；此页不显示被撤下正文。"]
      };
      const status = issue.state === "closed" && !["submission:published", "submission:withdrawn"].includes(key)
        ? ["投稿已关闭", "此Issue当前已关闭。若需继续处理，请在原投稿联系维护者。"]
        : statuses[key] || ["投稿已提交", "处理尚未开始，或这是一般内容请求；请在原Issue查看进度。"];
      result(box, status[0], ["投稿 #" + number, status[1]], { href: issue.html_url, text: "打开原投稿与回执 ↗" });
      history.replaceState(null, "", "?issue=" + number);
    } catch (error) { result(box, "暂时无法读取进度", [error.message], { href: "https://github.com/" + config.repository + "/issues/" + number, text: "直接打开GitHub查看 ↗" }); }
    finally { button.disabled = false; }
  });
  if (input.value) statusForm.requestSubmit();
}
const findForm = document.getElementById("find-form");
if (findForm) {
  const input = document.getElementById("location"), box = document.getElementById("find-result");
  const params = new URLSearchParams(location.search); input.value = params.get("code") || "";
  findForm.addEventListener("submit", async event => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase().replace(/\s/g, "");
    if (!/^CC-\d{6}$/.test(code) && !/^(\d{2})-(\d{2})$/.test(code)) { result(box, "请核对定位信息", ["输入CC-000001或12-34。"]); return; }
    if (!code.startsWith("CC") && code.split("-").some(x => Number(x) < 1 || Number(x) > 64)) { result(box, "定位码超出范围", ["两段数字均为01～64。"]); return; }
    try {
      const all = await fetch("/memorials.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
      const entry = all.find(x => x.id === code || x.locator === code);
      if (!entry) { result(box, "没有找到公开的纪念", ["这份投稿可能尚未发布、当前不公开，或定位信息来自另一个社区。请核对原回执。"]); return; }
      result(box, entry.title, [entry.id + " · 定位码 " + entry.locator, "网页可以阅读和分享。世界开放后，在入口输入同一码并确认标题。"], { href: "/entries/" + entry.id + "/", text: "打开这份纪念 ↗" });
      history.replaceState(null, "", "?code=" + encodeURIComponent(code));
    } catch { result(box, "目录暂时无法读取", ["请稍后重试，或使用回执中的分享链接。"]); }
  });
  if (input.value) findForm.requestSubmit();
}
document.querySelectorAll("[data-share]").forEach(button => button.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.origin + location.pathname); toast("分享链接已复制。"); }
  catch { toast("复制地址栏中的链接即可分享。"); }
}));
