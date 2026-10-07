import crypto from "node:crypto";
export class GitHub {
  constructor(repository, token, request = fetch) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9.-]+$/.test(repository)) throw new Error("Invalid repository");
    this.repository = repository; this.token = token; this.fetch = request;
  }
  async call(route, method = "GET", body, raw = false) {
    const response = await this.fetch("https://api.github.com/repos/" + this.repository + "/" + route, {
      method, headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: "Bearer " + this.token, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const error = new Error("GitHub request failed: " + method + " " + route + " (" + response.status + ")");
      error.status = response.status; throw error;
    }
    if (response.status === 204) return null;
    return raw ? response.text() : response.json();
  }
  async jsonAt(path, revision, fallback) {
    try { return JSON.parse(await this.call("contents/" + path + "?ref=" + encodeURIComponent(revision), "GET", undefined, true)); }
    catch (error) { if (error.status === 404 && fallback !== undefined) return structuredClone(fallback); throw error; }
  }
  async receipt(number, body) {
    const marker = "<!-- cyber-cemetery-receipt -->";
    const comments = await this.call("issues/" + number + "/comments?per_page=100");
    const existing = comments.find(c => c.user.type === "Bot" && c.body?.startsWith(marker));
    return this.call(existing ? "issues/comments/" + existing.id : "issues/" + number + "/comments", existing ? "PATCH" : "POST", { body: marker + "\n" + body });
  }
  async labels(number, desired) {
    const issue = await this.call("issues/" + number);
    const kept = issue.labels.map(x => x.name).filter(x => !x.startsWith("submission:"));
    return this.call("issues/" + number + "/labels", "PUT", { labels: [...kept, desired] });
  }
  async head() {
    const ref = await this.call("git/ref/heads/main");
    const commit = await this.call("git/commits/" + ref.object.sha);
    return { sha: ref.object.sha, tree: commit.tree.sha };
  }
  async commit(head, files, message) {
    return this.commitRef("heads/main", head, files, message, false);
  }
  async commitRef(refName, head, files, message, force = false) {
    const tree = [];
    for (const [path, value] of Object.entries(files)) {
      if (Buffer.isBuffer(value)) {
        const blob = await this.call("git/blobs", "POST", { content: value.toString("base64"), encoding: "base64" });
        tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      } else tree.push({ path, mode: "100644", type: "blob", content: value });
    }
    const nextTree = await this.call("git/trees", "POST", { base_tree: head.tree, tree });
    const commit = await this.call("git/commits", "POST", { message, tree: nextTree.sha, parents: [head.sha] });
    // Only bot-owned submission branches may be force-updated; main is never forced.
    await this.call("git/refs/" + refName, "PATCH", { sha: commit.sha, force });
    return commit.sha;
  }
  async ensureBranch(branch, sha) {
    try { return await this.call("git/ref/heads/" + branch); }
    catch (error) {
      if (error.status !== 404) throw error;
      return this.call("git/refs", "POST", { ref: "refs/heads/" + branch, sha });
    }
  }
  async findPullRequest(branch, state = "open") {
    const owner = this.repository.split("/")[0];
    const list = await this.call("pulls?head=" + encodeURIComponent(owner + ":" + branch) + "&state=" + state);
    return list[0] || null;
  }
  async upsertDraftPR(branch, title, body, head, files, message) {
    await this.ensureBranch(branch, head.sha);
    const sha = await this.commitRef("heads/" + branch, head, files, message, true);
    const existing = await this.findPullRequest(branch);
    const pull = existing
      ? await this.call("pulls/" + existing.number, "PATCH", { title, body })
      : await this.call("pulls", "POST", { title, body, head: branch, base: "main", draft: true, maintainer_can_modify: false });
    return { number: pull.number, url: pull.html_url, sha, draft: pull.draft };
  }
  async closePullRequest(number, comment) {
    const pull = await this.call("pulls/" + number, "PATCH", { state: "closed" });
    if (comment) await this.call("issues/" + number + "/comments", "POST", { body: comment });
    return pull;
  }
  async deploy() {
    await this.call("actions/workflows/pages.yml/dispatches", "POST", { ref: "main" });
  }
}
export const operationFilename = operation => crypto.createHash("sha256").update(operation).digest("hex");
