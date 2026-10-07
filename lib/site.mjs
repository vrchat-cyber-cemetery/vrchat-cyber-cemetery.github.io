import fs from "node:fs";
import path from "node:path";
import { TYPE_LABELS } from "./submissions.mjs";
import { packUrl, packMetadata, regionRevision } from "./runtime.mjs";

export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const e = escapeHtml;
export function page(title, content, project, active = "") {
  const navigation = [["/memorials/", "浏览纪念", "memorials"], ["/create/", "创建纪念", "create"], ["/status/", "投稿进度", "status"], ["/guide/", "参与指南", "guide"]];
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + "<title>" + e(title) + " · 赛博墓地</title>"
    + '<meta name="description" content="一个由社区共同保存的数字墓园。纪念人物，也纪念身份、关系、记忆和未完成的事物。">'
    + '<meta property="og:title" content="赛博墓地 Cyber Cemetery"><meta property="og:description" content="让值得纪念的事物，有处安放。">'
    + '<meta property="og:image" content="' + e(project.site_base) + '/assets/share.png">'
    + '<meta name="color-scheme" content="dark"><link rel="icon" href="/assets/mark.svg" type="image/svg+xml">'
    + '<link rel="stylesheet" href="/assets/style.css"><script type="module" src="/assets/app.js"></script></head><body>'
    + '<a class="skip" href="#main">跳到正文</a><header class="site-header"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">╋</span><span>赛博墓地<small>CYBER CEMETERY</small></span></a>'
    + '<nav aria-label="主导航">' + navigation.map(([url, label, key]) => '<a href="' + url + '"' + (key === active ? ' aria-current="page"' : "") + ">" + label + "</a>").join("")
    + '</nav></header><main id="main">' + content + '</main><footer class="site-footer"><a class="footer-brand" href="/">CYBER CEMETERY</a><p>社区共同保存 · 无需VRChat账号即可阅读</p><div><a href="/guide/#rights">公开与授权</a><a href="https://github.com/' + e(project.organization) + "/" + e(project.repositories.main)
    + '">GitHub</a><a href="/review/">参与评审</a></div></footer></body></html>';
}
function listItem(entry) {
  return '<a class="memorial-row" href="/entries/' + e(entry.id) + '/"><span class="row-number">' + e(entry.id) + '</span><div><span class="eyebrow">' + e(TYPE_LABELS[entry.buried_type]) + '</span><h3>' + e(entry.title) + '</h3><p>' + e(entry.epitaph || entry.buried_subject) + '</p></div><span class="row-locator">' + e(entry.locator) + ' <span aria-hidden="true">↗</span></span></a>';
}
function image(pathname, alt, cls = "") {
  if (!pathname) return "";
  if (!/^media\/[a-f0-9]{64}\.jpg$/.test(pathname)) throw new Error("Invalid approved media path");
  return '<img loading="lazy" class="' + cls + '" src="/assets/' + e(pathname) + '" alt="' + e(alt) + '">';
}
export function renderEntry(entry, project, preview = false) {
  const imageBlock = image(entry.images.main, "主图", "entry-main-image");
  const avatars = entry.players.map((p, i) => '<div class="person">' + image(entry.images.avatars[i], p.display_name + "头像") + '<span>' + e(p.display_name) + (p.profile_url ? '<a rel="noopener noreferrer" href="' + e(p.profile_url) + '">公开资料 ↗</a>' : "") + '</span></div>').join("");
  return page(entry.title, '<article class="entry-page"><div class="entry-meta"><a href="/memorials/">← 返回纪念</a><span>' + (preview ? "示例预览 · 不是真实投稿" : e(entry.id) + " · " + e(TYPE_LABELS[entry.buried_type])) + '</span></div>'
    + '<div class="entry-intro"><div><p class="eyebrow">这里埋葬了</p><h1>' + e(entry.buried_subject) + '</h1>'
    + (entry.epitaph ? '<blockquote>' + e(entry.epitaph) + '</blockquote>' : "") + (entry.date_note ? '<p class="muted">' + e(entry.date_note) + '</p>' : "")
    + '</div>' + (imageBlock ? '<figure>' + imageBlock + '</figure>' : '<div class="entry-stone" aria-hidden="true"><span>╋</span><i></i></div>') + '</div>'
    + '<div class="entry-body">' + (entry.story ? '<section><h2>留下的故事</h2><div class="story">' + e(entry.story) + '</div></section>' : "")
    + (avatars ? '<section><h2>相关玩家</h2><div class="people">' + avatars + '</div></section>' : "")
    + (entry.images.memorial.length ? '<section><h2>纪念图片</h2><div class="image-gallery">' + entry.images.memorial.map((x, i) => image(x, "纪念图片" + (i + 1))).join("") + '</div></section>' : "")
    + (entry.tags.length ? '<p class="tags">' + entry.tags.map(x => "<span># " + e(x) + "</span>").join("") + "</p>" : "")
    + (entry.links.length ? '<section><h2>相关链接</h2><ul class="links">' + entry.links.map(x => '<li><a rel="noopener noreferrer" href="' + e(x) + '">' + e(x) + ' ↗</a></li>').join("") + '</ul></section>' : "")
    + '<section class="entry-location"><p class="eyebrow">在墓园中找到这份纪念</p><div class="location-value">' + e(entry.locator) + '</div><p>第' + Number(entry.locator.slice(0, 2)) + '区 · 第' + Number(entry.locator.slice(3)) + '座</p><p class="notice">VRChat世界正在建设。当前可以阅读和分享网页，定位码已预留，世界开放后再按码前往。</p>'
    + '<a class="text-link" href="/find/?code=' + e(entry.locator) + '">定位说明 ↗</a></section>'
    + '<div class="entry-actions"><button class="button" type="button" data-share>复制分享链接</button><a class="text-link" href="/create/">创建另一份纪念 ↗</a>'
    + (preview ? "" : '<a class="muted-link" href="/guide/?entry=' + e(entry.id) + '#requests">请求修改或撤下</a>') + '</div>'
    + (preview ? '<p class="notice">这是用于介绍页面的虚构记忆示例，不占用真实墓位或创建次数。</p>' : '<p class="muted small">网页已发布 · 版本' + entry.publication_sequence + ' · ' + e(entry.updated_at.slice(0, 10)) + '</p>')
    + '</div></article>', project, "memorials");
}
const input = (id, label, hint, kind = "input", extra = "") => '<label class="field" for="' + id + '"><span>' + label + '</span><small>' + hint + '</small>' + (kind === "textarea" ? '<textarea id="' + id + '" name="' + id + '" ' + extra + '></textarea>' : '<input id="' + id + '" name="' + id + '" ' + extra + '>') + '</label>';
export function buildSite(root, output, project, policy, state, entries) {
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(root, "site/assets"), path.join(output, "assets"), { recursive: true });
  const publicEntries = entries.filter(x => x.status === "published");
  const write = (filename, value) => {
    const target = path.join(output, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write(".nojekyll", "");
  write("assets/site-config.json", JSON.stringify({ repository: project.organization + "/" + project.repositories.main, site_base: project.site_base, world_id: project.publication.vrchat_world_id, member_credits: policy.initial_creation_credits, review_exchange: policy.valid_reviews_per_credit, protocol_version: project.protocol_version, layout_version: project.layout_version, data_site_bases: project.data_site_bases }));
  write("memorials.json", JSON.stringify(publicEntries.map(x => ({ id: x.id, title: x.title, buried_type: x.buried_type, locator: x.locator, slot: x.slot }))));
  const rows = publicEntries.slice(-5).reverse().map(listItem).join("");
  write("index.html", page("让值得纪念的事物，有处安放", '<section class="hero"><div class="hero-art" aria-hidden="true"></div><div class="hero-copy"><p class="eyebrow">A COMMUNITY MEMORY GARDEN</p><h1>赛博墓地</h1><p class="hero-subtitle">让值得纪念的事物，<br>有处安放。</p><p class="hero-description">一个人，一段关系，一段记忆，<br>也可以是我们没完成的世界。</p><div class="hero-actions"><a class="button" href="/create/">创建一份纪念 <span>↗</span></a><a class="text-link" href="/guide/">了解如何参与</a></div></div><div class="hero-caption"><span>CYBER CEMETERY</span><span>纪念空间概念图 · 世界筹备中</span></div></section>'
    + '<section class="section intro-section"><p class="eyebrow">这里埋葬了什么</p><h2>结束的事物，<br>仍然值得被记住。</h2><div><p>这里不只纪念逝者。它也保存身份、关系、记忆、社区、项目和某个时代。</p><p>你可以为自己或他人建立一份纪念，不需要对应一个VRChat玩家。</p><a class="text-link" href="/preview/example/">看看一份纪念是什么样 ↗</a></div></section>'
    + '<section class="section"><div class="section-heading"><div><p class="eyebrow">共同保存的记忆</p><h2>公开的纪念</h2></div><a href="/memorials/" class="text-link">浏览全部 ↗</a></div>'
    + (rows || '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">╋</span><h3>故事将从这里开始</h3><p>目前还没有审核发布的纪念。你可以先创建一份，交由社区认真审核。</p><a class="text-link" href="/create/">开始填写 ↗</a></div>') + '</section>'
    + '<section class="section journey"><p class="eyebrow">从纪念到分享</p><h2>只需走过四步。</h2><ol><li><span>01</span><h3>填写</h3><p>写下想纪念的事物，图片可以稍后补充。</p></li><li><span>02</span><h3>提交</h3><p>内容带入GitHub，确认并添加图片后提交。</p></li><li><span>03</span><h3>审核</h3><p>在同一份投稿里跟踪进度、补充信息。</p></li><li><span>04</span><h3>分享</h3><p>发布后得到分享页和未来墓园的定位码。</p></li></ol></section>'
    + '<section class="final-call"><p class="eyebrow">留下一份纪念</p><h2>不是所有告别，<br>都需要悄无声息。</h2><a class="button" href="/create/">开始创建 ↗</a><p>每个社区成员初始一次机会，参与有效评审可以获得更多。</p></section>', project));
  const typeOptions = Object.entries(TYPE_LABELS).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join("");
  write("create/index.html", page("创建纪念", '<section class="page-heading"><p class="eyebrow">CREATE A MEMORIAL</p><h1>创建一份纪念</h1><p>先写下你想纪念的事物，再把内容带到GitHub提交。</p></section><div class="create-layout"><form id="memorial-form" novalidate><div class="steps" aria-label="填写步骤"><button type="button" data-step="1" aria-current="step">01 内容</button><button type="button" data-step="2">02 补充</button><button type="button" data-step="3">03 确认</button></div>'
    + '<section class="form-step" data-panel="1"><h2>这里埋葬了什么？</h2><p class="muted">不必是一个人。关系、记忆、身份、项目，都可以。</p>'
    + input("subject", "埋葬对象", "例如：我们未完成的世界", "input", 'maxlength="240" required autocomplete="off" placeholder="写下你想纪念的事物"')
    + '<label class="field" for="buried_type"><span>对象类型</span><select id="buried_type" name="buried_type">' + typeOptions + '</select></label>'
    + input("title", "标题（可选）", "留空时，我们会根据埋葬对象建议一个标题。", "input", 'maxlength="240" placeholder="给这份纪念一个名字"')
    + input("epitaph", "墓志铭（可选）", "一句你想留下的话。", "textarea", 'rows="3" maxlength="500" placeholder="如果有些话还没说完……"')
    + '<button class="button" type="button" data-next="2">下一步：补充故事 ↗</button></section>'
    + '<section class="form-step" data-panel="2" hidden><h2>留下更多细节</h2>'
    + input("story", "故事（可选）", "文字最长4000字符，纯文字投稿也可以。", "textarea", 'rows="8" maxlength="4000" placeholder="发生过什么？为什么你想记住它？"')
    + input("date_note", "日期与含义（可选）", "例如：结束日期 2024年夏天；不默认解释为生卒日期。", "input", 'maxlength="500"')
    + input("tags", "标签（可选）", "用逗号分隔，最多8个。", "input", 'placeholder="夏天，朋友，未完成"')
    + '<details class="optional-fields"><summary>相关玩家与链接</summary>'
    + input("players", "相关玩家（可选）", "每行一位，最多3位；可用“展示名 | 公开资料链接”。不需要登录用户名。", "textarea", 'rows="3"')
    + input("links", "相关链接（可选）", "每行一个http或https链接，最多8个。", "textarea", 'rows="3"') + '</details>'
    + '<div class="field"><span>图片预览（可选）</span><small>最多1张主图、3张纪念图、3个头像。这里仅本地预览，图片须在GitHub附件区上传。</small><label class="upload-zone" for="preview-files"><span>＋ 选择图片查看预览</span><small>JPG · PNG · WebP</small><input id="preview-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="image-previews" class="preview-strip"></div></div>'
    + '<div class="form-actions"><button class="quiet-button" type="button" data-prev="1">← 上一步</button><button class="button" type="button" data-next="3">下一步：确认提交 ↗</button></div></section>'
    + '<section class="form-step" data-panel="3" hidden><h2>确认公开与授权</h2><p>投稿会出现在公开GitHub Issue中。审核后才会发布到本站。</p>'
    + '<label class="check-field"><input type="checkbox" id="consent-public" required><span>我理解投稿、图片和Git历史可以被公开阅读、备份和分享。</span></label>'
    + '<label class="check-field"><input type="checkbox" id="consent-rights" required><span>我具备文字和图片的使用授权，允许展示与必要的格式处理。</span></label>'
    + '<label class="check-field"><input type="checkbox" id="consent-persons" required><span>涉及可识别他人时，我已取得所需同意；不会捏造死亡或公开隐私。</span></label>'
    + '<div class="notice"><strong>下一步会打开GitHub</strong><p>需要GitHub账号。请核对带入内容、再次确认授权、拖入图片，然后点击GitHub的提交按钮。本页不会直接发起投稿。</p></div>'
    + '<div id="transfer-note" class="notice" hidden></div><div class="form-actions"><button class="quiet-button" type="button" data-prev="2">← 上一步</button><button class="button" type="submit">前往GitHub提交 ↗</button></div>'
    + '<button class="text-link draft-button" type="button" id="copy-draft">复制完整投稿草稿</button><textarea id="draft-text" class="draft-text" readonly hidden aria-label="投稿草稿"></textarea></section>'
    + '<p id="form-error" class="form-error" role="alert"></p></form>'
    + '<aside class="live-preview"><p class="eyebrow">你的纪念预览</p><div class="preview-stone"><span class="stone-mark" aria-hidden="true">╋</span><p>这里埋葬了</p><h2 id="preview-subject">一份值得记住的事物</h2><blockquote id="preview-epitaph">你留下的话，会在这里。</blockquote><span id="preview-type">人物</span></div><p class="muted small">预览仅帮助表达。正式ID、分享页和定位码在审核发布后分配。</p><a class="text-link" href="/guide/">查看投稿指南 ↗</a></aside></div>'
    + '<noscript><p class="notice">你的浏览器未启用JavaScript，仍可直接使用<a href="https://github.com/' + e(project.organization) + "/" + e(project.repositories.main) + '/issues/new?template=memorial.yml">GitHub投稿表单</a>。</p></noscript>', project, "create"));
  write("memorials/index.html", page("浏览纪念", '<section class="page-heading"><p class="eyebrow">THE MEMORIAL ARCHIVE</p><h1>共同保存的纪念</h1><p>所有访客都可以阅读审核公开的内容。</p></section><section class="section archive-section">' + (publicEntries.length ? publicEntries.reverse().map(listItem).join("") : '<div class="empty-state"><span class="empty-symbol">╋</span><h2>等待第一份故事</h2><p>这里会展示审核发布后的纪念。</p><a class="button" href="/create/">创建一份纪念 ↗</a></div>') + '</section>', project, "memorials"));
  write("status/index.html", page("投稿进度", '<section class="page-heading"><p class="eyebrow">YOUR SUBMISSION</p><h1>查看投稿进度</h1><p>输入GitHub投稿编号或链接，了解下一步。</p></section><section class="section narrow"><form id="status-form"><label class="field" for="issue-number"><span>投稿编号或链接</span><small>例如：123，或你收到的GitHub Issue链接。</small><input id="issue-number" required placeholder="#123" autocomplete="off"></label><button class="button" type="submit">查看进度 ↗</button></form><div id="status-result" aria-live="polite"></div><p class="muted small">只读取公开投稿状态，不需要向本站提供GitHub密码或令牌。</p></section>', project, "status"));
  write("find/index.html", page("找到一份纪念", '<section class="page-heading"><p class="eyebrow">FIND A MEMORIAL</p><h1>找到一份纪念</h1><p>输入发布回执中的墓碑ID或定位码。</p></section><section class="section narrow"><form id="find-form"><label class="field" for="location"><span>墓碑ID / 定位码</span><small>CC-000001 或 12-34，两段数字均为01～64。</small><input id="location" required placeholder="12-34" autocomplete="off"></label><button class="button" type="submit">查找 ↗</button></form><div id="find-result" aria-live="polite"></div><div class="notice"><strong>VRChat世界正在建设</strong><p>当前定位码是固定位置的预留。世界开放后，在入口输入同一码、确认标题，然后指路或前往。</p></div></section>', project));
  write("guide/index.html", page("参与指南", '<section class="page-heading"><p class="eyebrow">HOW TO TAKE PART</p><h1>参与指南</h1><p>把注意力放在纪念本身，处理流程交给社区。</p></section><div class="guide-layout"><nav aria-label="指南目录"><a href="#submit">如何投稿</a><a href="#images">图片怎么提交</a><a href="#rights">公开与授权</a><a href="#credits">创建机会</a><a href="#requests">修改或撤下</a></nav><div>'
    + '<section id="submit"><h2>如何投稿</h2><ol><li>在本站填写埋葬对象和类型，故事、头像都可留空。</li><li>打开GitHub后，核对内容、选择对象类型并确认授权。</li><li>提交后在原Issue跟踪审核；需要补充时编辑原投稿。</li><li>网页发布成功后，你会收到分享链接、ID、定位码与发布版本。</li></ol><a class="button" href="/create/">开始填写 ↗</a></section>'
    + '<section id="images"><h2>图片怎么提交</h2><p>本站的文件选择仅供本地预览。请在GitHub表单里，把图片拖入“主图”“纪念图片”或“玩家头像”附件区。</p><p>支持静态JPG、PNG和WebP，单图不超过16MB。最多1张主图、3张纪念图，每位相关玩家1张头像；普通外部图片链接不会被下载。图片会等比规范化并处理透明背景。</p></section>'
    + '<section id="rights"><h2>公开与授权</h2><p>GitHub Issue、附件和Git历史是公开的。不要上传证件、登录信息、私人聊天或联系方式。</p><p>可以为他人建立纪念，但可识别健在人物需本人同意，逝者纪念和图片权限由人工核验。纪念不等于死亡名单。</p><p>撤下会停止本站展示，外部截图、聊天预览和他人的副本无法保证召回。</p></section>'
    + '<section id="credits"><h2>创建机会</h2><p>每个GitHub社区成员初始一次创建机会，VRChat绑定可选。只有审核接纳才扣一次，普通修改不收费，重复部署不会重复扣次。</p><p>政策采用3次经独立确认的有效评审换1次创建。评审兑换仍在试点准备中，暂未自动开放；邀请或转发不会发奖。</p></section>'
    + '<section id="requests"><h2>修改或撤下</h2><p>用墓碑ID提出请求，普通用户不需要操作仓库或修改JSON。</p><div class="guide-actions"><a class="text-link" href="https://github.com/' + e(project.organization) + "/" + e(project.repositories.main) + '/issues/new?template=edit.yml">提交修改 ↗</a><a class="text-link" href="https://github.com/' + e(project.organization) + "/" + e(project.repositories.main) + '/issues/new?template=request.yml">举报或请求撤下 ↗</a></div><p>不要在公开请求中复述隐私，必要材料由维护者通过受控渠道核验。</p></section></div></div>', project, "guide"));
  write("review/index.html", page("参与评审", '<section class="page-heading"><p class="eyebrow">CARE FOR THE COMMUNITY</p><h1>让每份纪念，<br>得到认真对待。</h1><p>有依据的支持、建议修改和拒绝，都可以是有价值的评审。</p></section><section class="section narrow"><h2>从真实待审投稿开始</h2><p>检查表达、人物同意、图片授权和数据完整性，提出具体理由。参与自己或利益相关的投稿不产生评审奖励。</p><a class="button" href="https://github.com/' + e(project.organization) + "/" + e(project.repositories.main) + '/issues?q=is%3Aissue+is%3Aopen+label%3Asubmission%3Areview">查看待审投稿 ↗</a><div class="notice"><strong>奖励兑换尚未自动开放</strong><p>pilot-v1为3次独立确认的有效评审换1次创建，单投稿最多2个获奖任务。基础投稿先开放，独立核验人员与兑换实现就绪后再启用。</p></div></section>', project));
  write("404.html", page("未找到页面", '<section class="page-heading"><p class="eyebrow">404</p><h1>这里没有公开的纪念。</h1><p>链接可能有误，或内容当前不公开。</p><a class="button" href="/memorials/">返回纪念档案 ↗</a></section>', project));
  const demo = { id: "示例", buried_type: "memory", buried_subject: "那段没来得及告别的夏天", title: "夏日记忆示例", epitaph: "风还在吹，但我们已经走向不同的方向。", story: "我们曾在同一个世界里，看日落、聊天、等一个迟到的人。\n\n后来，世界关闭了，名字变了，有些对话停在了最后一句。\n\n这里保存的不是谁离开了，而是那段确实存在过的时光。", date_note: "记忆时间：一个夏天", players: [], images: { main: null, memorial: [], avatars: [] }, tags: ["记忆", "夏天"], links: [], locator: "12-34" };
  write("preview/example/index.html", renderEntry(demo, project, true));
  for (const entry of entries) {
    write("entries/" + entry.id + "/index.html", entry.status === "published" ? renderEntry(entry, project) : page("这份纪念当前不公开", '<section class="page-heading"><p class="eyebrow">MEMORIAL UNAVAILABLE</p><h1>这份纪念当前不公开。</h1><p>你仍然可以浏览其他公开的纪念，或联系社区维护者。</p><a class="button" href="/memorials/">浏览纪念 ↗</a></section>', project));
  }
  for (const entry of publicEntries) {
    for (const file of [entry.images.main, ...entry.images.memorial, ...entry.images.avatars].filter(Boolean)) {
      if (!/^media\/[a-f0-9]{64}\.jpg$/.test(file)) throw new Error("Invalid media reference");
      const source = fs.realpathSync(path.join(root, file));
      if (!source.startsWith(fs.realpathSync(path.join(root, "media")) + path.sep)) throw new Error("Media outside approved directory");
      const target = path.join(output, "assets", file);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
    }
  }
  // The Unity world and its BC1 publication are not ready: expose truthful empty data, never fake readiness.
  const regionSummaries = Array.from({ length: 64 }, (_, region) => {
    const inRegion = publicEntries.filter(x => Math.floor(x.slot / 64) === region);
    const groups = Array.from({ length: 8 }, (_, group) => {
      const meta = packMetadata(project, publicEntries, region, group);
      return { group, pack: region * 8 + group, revision: meta.revision, url: packUrl(project, region * 8 + group) };
    });
    return {
      region, published_count: inRegion.length, revision: regionRevision(inRegion, groups.map(g => g.revision)),
      file: {
        schema: 1, region, layout_version: project.layout_version, revision: regionRevision(inRegion, groups.map(g => g.revision)),
        entries: inRegion.map(x => ({ id: x.id, slot: x.slot % 64, title: x.title })), groups
      }
    };
  });
  write("catalog.json", JSON.stringify({ schema: 1, community_id: project.community_id, layout_version: project.layout_version, publication_sequence: state.publication_sequence, world_status: "awaiting_world", regions: regionSummaries.map(x => ({ region: x.region, published_count: x.published_count, revision: x.revision })) }));
  for (const summary of regionSummaries) write("regions/" + String(summary.region).padStart(2, "0") + ".json", JSON.stringify(summary.file));
  return { publicCount: publicEntries.length, publicationSequence: state.publication_sequence };
}
