// Fixed runtime address layout: 1 catalog + 64 regions + 512 packs = 577 preset URLs.
// The world only ever selects from this list; it never concatenates paths or adds cache-busting parameters.

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
