// Fixed runtime address layout: 1 catalog + 64 regions + 512 packs = 577 preset URLs.
// The world only ever selects from this list; it never concatenates paths or adds cache-busting parameters.

import crypto from "node:crypto";

export const EMPTY_REVISION = "empty-v1";

const digest = value => crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export function catalogUrl(project) {
  return project.site_base + "/catalog.json";
}

export function regionUrl(project, region) {
  return project.site_base + "/regions/" + String(region).padStart(2, "0") + ".json";
}

export function packIndex(region, group) {
  return region * 8 + group;
}

export function packShard(project, index) {
  const shards = project.data_site_bases.length;
  const perShard = project.capacity.pack_count / shards;
  if (!Number.isInteger(perShard) || perShard < 1) throw new Error("Pack count does not divide evenly across data sites");
  return Math.floor(index / perShard);
}

export function packUrl(project, index) {
  if (!Number.isInteger(index) || index < 0 || index >= project.capacity.pack_count) throw new Error("Pack index outside capacity");
  return project.data_site_bases[packShard(project, index)] + "/packs/" + String(index).padStart(3, "0") + ".bin";
}

export function buildAddressManifest(project) {
  const regions = Array.from({ length: project.capacity.regions }, (_, region) => regionUrl(project, region));
  const packs = Array.from({ length: project.capacity.pack_count }, (_, index) => packUrl(project, index));
  if (regions.length !== 64 || packs.length !== 512 || new Set([...regions, ...packs, catalogUrl(project)]).size !== 577)
    throw new Error("Address manifest must contain exactly 577 unique fixed URLs");
  return {
    schema: 1,
    community_id: project.community_id,
    protocol_version: project.protocol_version,
    layout_version: project.layout_version,
    catalog: catalogUrl(project),
    regions,
    packs,
    counts: { catalog: 1, regions: regions.length, packs: packs.length, total: 577 }
  };
}

// Metadata embedded in one pack; entries carry approved text only. Image presence flags stay false
// until GH-03 builds real BC1 atlases, so a flag never promises pixels the pack does not contain.
export function packMetadata(project, published, region, group) {
  const positions = Array.from({ length: 8 }, () => null);
  for (const entry of published) {
    if (Math.floor(entry.slot / 64) !== region) continue;
    const local = entry.slot % 64;
    if (Math.floor(local / 8) !== group) continue;
    positions[local % 8] = {
      id: entry.id, slot: local % 8, revision: entry.approved_revision,
      title: entry.title, buried_type: entry.buried_type, buried_subject: entry.buried_subject,
      epitaph: entry.epitaph || "", story: entry.story || "", date_note: entry.date_note || "",
      images: { main: false, memorial: [false, false, false], avatars: [false, false, false] }
    };
  }
  return {
    schema: 1, community_id: project.community_id, layout_version: project.layout_version,
    region, group, revision: positions.every(x => x === null) ? EMPTY_REVISION : digest(positions),
    entries: positions
  };
}

export function regionRevision(published, groupRevisions) {
  if (!published.length) return EMPTY_REVISION;
  return digest(published.map(x => [x.id, x.approved_revision]).concat([groupRevisions]));
}
