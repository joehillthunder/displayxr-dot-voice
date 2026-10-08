// Generates assets/splats/planet.ply: a procedural ringed planet as 3D Gaussian splats, in the
// standard 3DGS PLY layout (position, normal, DC colour, logit opacity, log scale, quaternion).
// Written by this repo, so it carries the repo's own terms (dedicated CC0 in assets/LICENSES.md).
//   node tools/make-splat.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SH_C0 = 0.28209479177387814;
const PROPS = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
  'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

// Deterministic PRNG so the file is reproducible byte for byte.
let seed = 0x5eed;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

type Splat = { p: [number, number, number]; c: [number, number, number]; a: number; s: number };
const splats: Splat[] = [];

// Planet: points on a sphere, coloured in latitude bands.
const R = 0.5;
for (let i = 0; i < 22000; i++) {
  const u = rand() * 2 - 1;
  const th = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  const lat = u;
  const band = 0.5 + 0.5 * Math.sin(lat * 14 + Math.sin(th * 3) * 0.6);
  const c: [number, number, number] = [0.85 * band + 0.15, 0.55 * band + 0.25, 0.3 + 0.25 * (1 - band)];
  splats.push({ p: [R * r * Math.cos(th), R * lat, R * r * Math.sin(th)], c, a: 0.95, s: 0.018 });
}
// Rings: a thin tilted disk with gaps.
const tilt = 0.45;
for (let i = 0; i < 14000; i++) {
  const rr = 0.7 + rand() * 0.45;
  if (rr > 0.92 && rr < 0.96) continue; // the gap
  const th = rand() * Math.PI * 2;
  const x = rr * Math.cos(th);
  const z = rr * Math.sin(th);
  const y = (rand() - 0.5) * 0.01;
  const shade = 0.6 + 0.4 * Math.sin(rr * 60);
  splats.push({
    p: [x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)],
    c: [0.75 * shade + 0.2, 0.7 * shade + 0.2, 0.65 * shade + 0.25], a: 0.7, s: 0.012,
  });
}
// A few moons.
for (const [mx, my, mz, mr] of [[1.35, 0.25, -0.2, 0.07], [-1.2, -0.3, 0.5, 0.05]] as const) {
  for (let i = 0; i < 1500; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const g = 0.6 + rand() * 0.25;
    splats.push({ p: [mx + mr * r * Math.cos(th), my + mr * u, mz + mr * r * Math.sin(th)], c: [g, g, g * 1.05], a: 0.95, s: 0.01 });
  }
}

const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${splats.length}\n` +
  PROPS.map((p) => `property float ${p}\n`).join('') + 'end_header\n';
const body = new Float32Array(splats.length * PROPS.length);
const logit = (a: number) => Math.log(a / (1 - a));
splats.forEach((s, i) => {
  const o = i * PROPS.length;
  body.set([
    s.p[0], -s.p[1], s.p[2], // most 3DGS viewers expect Y-down captures
    0, 0, 0,
    (s.c[0] - 0.5) / SH_C0, (s.c[1] - 0.5) / SH_C0, (s.c[2] - 0.5) / SH_C0,
    logit(s.a),
    Math.log(s.s), Math.log(s.s), Math.log(s.s),
    1, 0, 0, 0,
  ], o);
});

const out = fileURLToPath(new URL('../assets/splats/', import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(out + 'planet.ply', Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body.buffer)]));
console.log(`wrote ${out}planet.ply (${splats.length} splats)`);
