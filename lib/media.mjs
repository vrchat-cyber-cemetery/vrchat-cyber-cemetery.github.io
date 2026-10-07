import crypto from "node:crypto";
import sharp from "sharp";

function sourceAllowed(url, redirected) {
  const host = new URL(url).hostname;
  return host === "github.com" || host === "user-images.githubusercontent.com"
    || (redirected && (host === "private-user-images.githubusercontent.com"
      || /^github-production-user-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(host)));
}
export async function fetchImage(url, request = fetch) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !sourceAllowed(current, redirects > 0)) throw new Error("图片来源不支持，请用GitHub公开附件。");
    const response = await request(current, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("图片附件重定向无效。");
      current = new URL(location, current).href; continue;
    }
    if (!response.ok) throw new Error("无法读取图片附件，请确认是公开的GitHub附件。");
    if (Number(response.headers.get("content-length")) > 16 * 1024 * 1024) throw new Error("单张图片最多16MB。");
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error("单张图片最多16MB。"); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("图片附件重定向过多。");
}
export async function normalizeImage(bytes) {
  const image = sharp(bytes, { limitInputPixels: 32000000, animated: false });
  const info = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(info.format) || (info.pages || 1) > 1) throw new Error("图片只支持静态JPG、PNG和WebP。");
  const output = await image.rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#e5e2d8" }).jpeg({ quality: 82 }).toBuffer();
  if (output.length > 1024 * 1024) throw new Error("规范化后图片仍超过1MB，请先压缩图片。");
  return { path: "media/" + crypto.createHash("sha256").update(output).digest("hex") + ".jpg", bytes: output };
}
export async function prepareMedia(images, request = fetch) {
  const files = {};
  async function convert(url) {
    if (!url) return null;
    const normalized = await normalizeImage(await fetchImage(url, request));
    files[normalized.path] = normalized.bytes; return normalized.path;
  }
  return { files, images: {
    main: await convert(images.main),
    memorial: await Promise.all(images.memorial.map(convert)),
    avatars: await Promise.all(images.avatars.map(convert))
  } };
}
// Pre-approval preview: runs the exact normalization used at publish time and reports the
// real scaled dimensions, flattened background and byte size without writing into media/.
export async function previewReport(images, request = fetch) {
  async function measure(url) {
    if (!url) return null;
    const normalized = await normalizeImage(await fetchImage(url, request));
    const info = await sharp(normalized.bytes).metadata();
    return { source: url, path: normalized.path, width: info.width, height: info.height, bytes: normalized.bytes.length, background: "#e5e2d8" };
  }
  return {
    main: await measure(images.main),
    memorial: await Promise.all(images.memorial.map(measure)),
    avatars: await Promise.all(images.avatars.map(measure))
  };
}
