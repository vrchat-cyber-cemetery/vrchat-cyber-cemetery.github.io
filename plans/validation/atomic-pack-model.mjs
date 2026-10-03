// Design-model tests only. Does not run Unity, Udon, a GPU, or a network request.
import assert from "node:assert/strict";

const HEADER = 32;
const JSON_LIMIT = 128 * 1024;
const PIXELS = 2048 * 2048 / 2;
const MAX_PACK = HEADER + JSON_LIMIT + PIXELS;
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  process.stdout.write(`PASS ${name}\n`);
}

function metadata(region = 12, group = 4, revision = "r2") {
  return {
    schema: 1, community_id: "test-community", layout_version: "layout1",
    region, group, revision,
    entries: Array.from({ length: 8 }, (_, i) => ({
      id: `CC-${String(region * 64 + group * 8 + i + 1).padStart(6, "0")}`,
      slot: group * 8 + i, title: `合成墓碑 ${i}`, story: "这里只是测试数据。"
    }))
  };
}

function pack(meta, withImage = true) {
  const json = Buffer.from(JSON.stringify(meta), "utf8");
  const result = Buffer.alloc(HEADER + json.length + (withImage ? PIXELS : 0));
  result.write("CCPACK01", 0, "ascii");
  result.writeUInt32LE(json.length, 8);
  result.writeUInt32LE(withImage ? PIXELS : 0, 12);
  result.writeUInt16LE(withImage ? 2048 : 0, 16);
  result.writeUInt16LE(withImage ? 2048 : 0, 18);
  result[20] = withImage ? 1 : 0;
  result.writeUInt16LE(withImage ? 1 : 0, 22);
  json.copy(result, HEADER);
  // Remaining all-zero BC1 blocks are deterministic synthetic data, not user media.
  return result;
}

function parse(bytes, expected) {
  assert(bytes.length >= HEADER && bytes.length <= MAX_PACK);
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "CCPACK01");
  const jsonLength = bytes.readUInt32LE(8), pixelLength = bytes.readUInt32LE(12);
  const width = bytes.readUInt16LE(16), height = bytes.readUInt16LE(18);
  const format = bytes[20], mips = bytes.readUInt16LE(22);
  assert(jsonLength >= 1 && jsonLength <= JSON_LIMIT);
  assert.equal(bytes[21], 0);
  assert(bytes.subarray(24, 32).every(x => x === 0));
  assert.equal(bytes.length, HEADER + jsonLength + pixelLength);
  assert(
    (format === 0 && pixelLength === 0 && width === 0 && height === 0 && mips === 0) ||
    (format === 1 && pixelLength === PIXELS && width === 2048 && height === 2048 && mips === 1)
  );
  const value = JSON.parse(bytes.subarray(HEADER, HEADER + jsonLength).toString("utf8"));
  assert.equal(value.schema, 1);
  for (const key of ["community_id", "layout_version", "region", "group", "revision"])
    assert.equal(value[key], expected[key]);
  assert(Number.isInteger(value.region) && value.region >= 0 && value.region < 64);
  assert(Number.isInteger(value.group) && value.group >= 0 && value.group < 8);
  assert.equal(typeof value.revision, "string");
  assert(Array.isArray(value.entries) && value.entries.length === 8);
  const ids = new Set();
  value.entries.forEach((entry, i) => {
    if (entry === null) return;
    assert.equal(entry.slot, value.group * 8 + i);
    assert.match(entry.id, /^CC-\d{6}$/);
    assert(!ids.has(entry.id));
    ids.add(entry.id);
  });
  return { value, pixelOffset: HEADER + jsonLength, pixelLength };
}

const expected = metadata();
const valid = pack(expected);
test("current complete package accepted", () => assert.equal(parse(valid, expected).pixelLength, PIXELS));
test("binary zero/non-UTF8 bytes are payload not JSON", () => {
  const binary = Buffer.from(valid);
  binary[binary.length - 1] = 255;
  assert.equal(parse(binary, expected).value.revision, "r2");
});
test("old cached package rejected", () => assert.throws(() => parse(pack(metadata(12, 4, "r1")), expected)));
test("new package rejected against old expected revision", () => assert.throws(() => parse(valid, metadata(12, 4, "r1"))));
test("wrong group rejected", () => assert.throws(() => parse(pack(metadata(12, 3)), expected)));
test("wrong community rejected", () => assert.throws(() => parse(valid, { ...expected, community_id: "another" })));
test("wrong layout rejected", () => assert.throws(() => parse(valid, { ...expected, layout_version: "layout2" })));
test("truncation rejected", () => assert.throws(() => parse(valid.subarray(0, -1), expected)));
test("trailing bytes rejected", () => assert.throws(() => parse(Buffer.concat([valid, Buffer.from([0])]), expected)));
test("short header rejected", () => assert.throws(() => parse(Buffer.alloc(8), expected)));

for (const [name, mutate] of [
  ["magic", b => { b[0] = 0; }],
  ["JSON over limit", b => b.writeUInt32LE(JSON_LIMIT + 1, 8)],
  ["empty JSON", b => b.writeUInt32LE(0, 8)],
  ["invalid pixel count", b => b.writeUInt32LE(PIXELS - 8, 12)],
  ["width", b => b.writeUInt16LE(1024, 16)],
  ["height", b => b.writeUInt16LE(1024, 18)],
  ["format", b => { b[20] = 9; }],
  ["reserved flag", b => { b[21] = 1; }],
  ["mip count", b => b.writeUInt16LE(2, 22)],
  ["reserved bytes", b => { b[24] = 1; }]
]) test(`invalid ${name} rejected`, () => {
  const damaged = Buffer.from(valid);
  mutate(damaged);
  assert.throws(() => parse(damaged, expected));
});

test("null unpublished entries accepted without hidden identity", () => {
  const data = metadata();
  data.entries[3] = null;
  assert.equal(parse(pack(data), expected).value.entries[3], null);
});
test("misbound slot rejected", () => {
  const data = metadata();
  data.entries[3].slot = 1;
  assert.throws(() => parse(pack(data), expected));
});
test("duplicate entry ID rejected", () => {
  const data = metadata();
  data.entries[3].id = data.entries[0].id;
  assert.throws(() => parse(pack(data), expected));
});
test("metadata-only package creates no pixel allocation", () => assert.equal(parse(pack(expected, false), expected).pixelLength, 0));
test("all 4096 locations map bijectively", () => {
  const locations = new Set(), packages = new Set();
  for (let slot = 0; slot < 4096; slot++) {
    const region = Math.floor(slot / 64), local = slot % 64;
    const group = Math.floor(local / 8), member = local % 8;
    const packageId = region * 8 + group;
    assert.equal(packageId * 8 + member, slot);
    packages.add(packageId);
    locations.add(`${String(region + 1).padStart(2, "0")}-${String(local + 1).padStart(2, "0")}`);
  }
  assert.equal(packages.size, 512);
  assert.equal(locations.size, 4096);
});
test("56 logical images fit without overlap", () => {
  const rectangles = [];
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 1024;
    const blocks = [[0, 512, 512], [0, 256, 256], [256, 256, 256], [0, 0, 256],
      [256, 128, 128], [384, 128, 128], [256, 0, 128]];
    for (const [dx, dy, size] of blocks) rectangles.push({ x: x + dx + 2, y: y + dy + 2, w: size - 4, h: size - 4 });
  }
  assert.equal(rectangles.length, 56);
  for (let i = 0; i < rectangles.length; i++) {
    const a = rectangles[i];
    assert(a.x >= 0 && a.y >= 0 && a.x + a.w <= 2048 && a.y + a.h <= 2048);
    for (let j = i + 1; j < rectangles.length; j++) {
      const b = rectangles[j];
      assert(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }
  }
});
test("directory invalidation blocks late callback", () => {
  const state = { generation: 1, visible: "old", expected: "r1" };
  const captured = state.generation;
  state.generation++;
  state.visible = null;
  state.expected = "r2";
  const canApply = captured === state.generation && "r1" === state.expected;
  assert.equal(canApply, false);
  assert.equal(state.visible, null);
});
function locate(input) {
  const match = /^(\d{2})-(\d{2})$/.exec(input.replace(/\s/g, ""));
  assert(match);
  const region = Number(match[1]), slot = Number(match[2]);
  assert(region >= 1 && region <= 64 && slot >= 1 && slot <= 64);
  return { region: region - 1, slot: slot - 1 };
}
test("friendly location code maps to zero-based data", () => {
  assert.deepEqual(locate("12-34"), { region: 11, slot: 33 });
  assert.deepEqual(locate("01-01"), { region: 0, slot: 0 });
  assert.deepEqual(locate("64-64"), { region: 63, slot: 63 });
});
test("invalid location codes rejected before any request", () => {
  for (const code of ["00-01", "65-01", "01-65", "12-3", "https://example.com", "<script>"])
    assert.throws(() => locate(code));
});
test("hard capacity arithmetic", () => {
  assert.equal(1 + 64 + 512, 577);
  assert.equal(PIXELS, 2097152);
  assert.equal(MAX_PACK, 2228256);
  assert.equal(MAX_PACK * 512 / 1024 ** 2, 1088.015625);
  assert(MAX_PACK * 256 < 700 * 1024 ** 2);
  assert.equal(PIXELS * 3 / 1024 ** 2, 6);
});
console.log(JSON.stringify({ checks, addressCount: 577, logicalCapacity: 4096, maxPackBytes: MAX_PACK,
  maxDataShardMiB: MAX_PACK * 256 / 1024 ** 2, unityOrNetworkExecuted: false }, null, 2));
