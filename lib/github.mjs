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
    const tree = [];
    for (const [path, value] of Object.entries(files)) {
      if (Buffer.isBuffer(value)) {
        const blob = await this.call("git/blobs", "POST", { content: value.toString("base64"), encoding: "base64" });
        tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      } else tree.push({ path, mode: "100644", type: "blob", content: value });
    }
    const nextTree = await this.call("git/trees", "POST", { base_tree: head.tree, tree });
    const commit = await this.call("git/commits", "POST", { message, tree: nextTree.sha, parents: [head.sha] });
    await this.call("git/refs/heads/main", "PATCH", { sha: commit.sha, force: false });
    return commit.sha;
  }
  async deploy() {
    await this.call("actions/workflows/pages.yml/dispatches", "POST", { ref: "main" });
  }
}
export const operationFilename = operation => crypto.createHash("sha256").update(operation).digest("hex");
