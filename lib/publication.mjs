import crypto from "node:crypto";

// Publication build primitives shared by the Windows builder and the offline tests.
// Atlas layout follows RUNTIME-DATA section 6; the DDS reader must parse the container
// instead of assuming a fixed header length.

export const TEXCONV = {
  version: "may2026",
  url: "https://github.com/microsoft/DirectXTex/releases/download/may2026/texconv.exe",
  sha256: "dcfdec10244e02cf5037fba089c55fb7e1326b1c8181742d77d15fa5cb5eef06",
  bytes: 966480
};

// Rectangles inside one 512x1024 strip: main 512² on top; the bottom 512² splits into four
// 256² cells (three memorial); the last 256² cell splits into four 128² (three avatars, one empty).
export function atlasCells(stripIndex) {
  const x = (stripIndex % 4) * 512, y = Math.floor(stripIndex / 4) * 1024;
  const cells = [{ role: "main", x: x + 2, y: y + 2, size: 508 }];
  const memorial = [[0, 512], [256, 512], [0, 768]];
  for (const [dx, dy] of memorial) cells.push({ role: "memorial", x: x + dx + 2, y: y + dy + 2, size: 252 });
  const avatars = [[256, 768], [384, 768], [256, 896]];
  for (const [dx, dy] of avatars) cells.push({ role: "avatar", x: x + dx + 2, y: y + dy + 2, size: 124 });
  return cells;
}

export const ATLAS_BACKGROUND = "#101216";

// Extract the raw BC1 block data from a DDS container produced by texconv -f BC1_UNORM -m 1.
export function bc1BlocksFromDDS(bytes) {
  const header = Buffer.from(bytes);
  if (header.length < 132 || header.readUInt32LE(0) !== 0x20534444) throw new Error("不是DDS容器。");
  const height = header.readUInt32LE(12), width = header.readUInt32LE(16);
  const mips = header.readUInt32LE(28);
  const fourCC = header.toString("ascii", 84, 88);
  if (width !== 2048 || height !== 2048) throw new Error("图集尺寸不是2048×2048。");
  if (mips !== 1) throw new Error("图集必须单mip。");
  if (fourCC !== "DXT1") throw new Error("像素格式不是BC1/DXT1:" + fourCC + "。");
  const expected = (width / 4) * (height / 4) * 8;
  const data = header.subarray(128);
  if (data.length !== expected) throw new Error("BC1块数据长度不符:期望" + expected + ",实际" + data.length + "。");
  return Buffer.from(data);
}

export const CCPACK = { header: 32, jsonLimit: 128 * 1024, textureBytes: 2048 * 2048 / 2 };

export function encodePack(meta, texture) {
  const json = Buffer.from(JSON.stringify(meta), "utf8");
  if (json.length < 1 || json.length > CCPACK.jsonLimit) throw new Error("包JSON超出协议范围。");
  const pixels = texture ? Buffer.from(texture) : null;
  if (pixels && pixels.length !== CCPACK.textureBytes) throw new Error("纹理块必须恰好2MiB。");
  const pack = Buffer.alloc(CCPACK.header + json.length + (pixels ? pixels.length : 0));
  pack.write("CCPACK01", 0, "ascii");
  pack.writeUInt32LE(json.length, 8);
  pack.writeUInt32LE(pixels ? pixels.length : 0, 12);
  pack.writeUInt16LE(pixels ? 2048 : 0, 16);
  pack.writeUInt16LE(pixels ? 2048 : 0, 18);
  pack[20] = pixels ? 1 : 0;
  pack[21] = 0;
  pack.writeUInt16LE(pixels ? 1 : 0, 22);
  json.copy(pack, CCPACK.header);
  if (pixels) pixels.copy(pack, CCPACK.header + json.length);
  if (pack.length > 2228256) throw new Error("单包超出硬预算2,228,256字节。");
  return pack;
}

export function checkBudgets(project, shardTotals, siteBytes) {
  const perShardCap = 2228256 * 256; // 544.0078125MiB, below the 700MiB project budget
  const failures = [];
  for (const [name, total] of Object.entries(shardTotals)) if (total > perShardCap) failures.push(name + " 分片超出 " + perShardCap + " 字节上限");
  if (siteBytes > project.budgets.site_bytes) failures.push("主站超出700MiB预算");
  if (failures.length) throw new Error(failures.join(";"));
  return { perShardCap, checked: Object.keys(shardTotals).length + 1 };
}

export function publicationRecord({ publication_id, sequence, source_sha, project, archives, requested_by, requested_at, status = "requested" }) {
  const record = {
    schema_version: 1, publication_id, publication_sequence: sequence, source_sha,
    protocol_version: project.protocol_version, layout_version: project.layout_version, status,
    archives, requested_by, requested_at, activated_at: null
  };
  if (!/^[0-9a-f]{40}$/.test(source_sha)) throw new Error("source_sha必须是40位提交。");
  if (sequence < 1) throw new Error("发布序号必须从1开始单调递增。");
  return record;
}

export const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");
