// Builds the small data files the admin dashboard map uses:
//   src/admin/world.json  outline of the world's countries (Natural Earth projection, 960×500)
//   src/admin/zones.json  time zone → [country code, latitude, longitude] from the IANA database
// Run with: node scripts/gen-geo.mjs   (needs the world-atlas, topojson-client and d3-geo dev packages)
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';

const W = 960, H = 470;
const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-110m.json', import.meta.url)));
const land = feature(topo, topo.objects.countries);
land.features = land.features.filter((f) => f.properties.name !== 'Antarctica');
const proj = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], land);
const path = geoPath(proj).digits(1);
const d = land.features.map((f) => path(f)).filter(Boolean).join('');
writeFileSync(new URL('../src/admin/world.json', import.meta.url),
  JSON.stringify({ w: W, h: H, k: proj.scale(), tx: proj.translate()[0], ty: proj.translate()[1], d }));

const dms = (s) => {
  // ±DDMM or ±DDMMSS / ±DDDMM or ±DDDMMSS
  const sign = s[0] === '-' ? -1 : 1, n = s.slice(1);
  const degLen = n.length === 4 || n.length === 6 ? 2 : 3;
  const deg = +n.slice(0, degLen), min = +n.slice(degLen, degLen + 2), sec = +(n.slice(degLen + 2) || 0);
  return +(sign * (deg + min / 60 + sec / 3600)).toFixed(2);
};
const zones = {};
for (const line of readFileSync('/usr/share/zoneinfo/zone.tab', 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cc, coord, tz] = line.split('\t');
  const m = coord.match(/^([+-]\d+)([+-]\d+)$/);
  zones[tz] = [cc, dms(m[1]), dms(m[2])];
}
// Old names browsers still report (e.g. Asia/Calcutta, Europe/Kiev)
for (const line of readFileSync('/usr/share/zoneinfo/tzdata.zi', 'utf8').split('\n')) {
  const [kind, target, alias] = line.split(' ');
  if (kind === 'L' && zones[target] && !zones[alias]) zones[alias] = zones[target];
}
writeFileSync(new URL('../src/admin/zones.json', import.meta.url), JSON.stringify(zones));
console.log('world path', d.length, 'chars;', Object.keys(zones).length, 'zones');
