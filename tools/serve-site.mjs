import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("build/site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
http.createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const filename = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (filename !== root && !filename.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    let target = filename;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.existsSync(target)) { response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); response.end(fs.readFileSync(path.join(root, "404.html"))); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(target).pipe(response);
  } catch { response.writeHead(400); response.end("Bad request"); }
}).listen(4173, "127.0.0.1", () => console.log("Local preview http://127.0.0.1:4173"));
