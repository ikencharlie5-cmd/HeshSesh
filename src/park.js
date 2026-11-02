// Terrain park: one linear line, top to bottom.
//   Drop-in -> rail garden (flat box, flat-down rail, down rail, kinked rail,
//   long box: all ride-on from small snow ramps) -> three tables (S/M/L) ->
//   superpipe -> runout.
// Pure JS so the physics can be tested in Node.
import { makeKicker } from './features.js';
import { treeGrid } from './terrain.js';

const DEG = Math.PI / 180;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const PROFILE = [[-30, 0], [12, 0], [24, 22], [50, 10], [230, 9], [250, 14], [470, 14], [490, 17],
  [715, 17], [745, 4], [800, 0]];
const LENGTH = 790, HALF_W = 60;

// halfpipe dimensions (a 5 m "superpipe" scaled for skiing)
const PIPE = { s0: 495, s1: 705, flat: 7, R: 5.5, maxDeg: 84, deck: 4 };

export function createPark() {
  const STEP = 0.5, s0 = -40;
  const n = Math.ceil((LENGTH + 80) / STEP);
  const elev = new Float64Array(n + 1);
  let pi = 0;
  const pitch = (s) => {
    while (pi < PROFILE.length - 2 && s > PROFILE[pi + 1][0]) pi++;
    const [a0, p0] = PROFILE[pi], [a1, p1] = PROFILE[pi + 1];
    return (p0 + (p1 - p0) * Math.min(1, Math.max(0, (s - a0) / (a1 - a0)))) * DEG;
  };
  for (let i = 1; i <= n; i++) elev[i] = elev[i - 1] - Math.tan(pitch(s0 + (i - 0.5) * STEP)) * STEP;
  const profileY = (s) => {
    const f = (Math.min(Math.max(s, s0), s0 + n * STEP) - s0) / STEP;
    const i = Math.min(n - 1, Math.floor(f));
    return elev[i] + (elev[i + 1] - elev[i]) * (f - i);
  };

  // gentle side walls so you can't ride off the park
  function baseHeight(x, z) {
    const ax = Math.abs(x);
    return profileY(-z) + Math.max(0, ax - 30) ** 2 * 0.01 + Math.max(0, ax - 50) ** 2 * 0.05;
  }

  // ------------------------------------------------------------- halfpipe
  const Rs = PIPE.R * Math.sin(PIPE.maxDeg * DEG);
  const Htop = PIPE.R * (1 - Math.cos(PIPE.maxDeg * DEG));
  const inner = PIPE.flat, wallEnd = inner + Rs, deckEnd = wallEnd + PIPE.deck;
  const outerEnd = deckEnd + Htop / 0.8;
  const pipeLen = PIPE.s1 - PIPE.s0;
  const pipe = {
    name: 'Halfpipe', kind: 'pipe', x0: 0, z0: -PIPE.s0, a: { x: 0, z: -1 }, b: { x: 1, z: 0 },
    L: pipeLen, reach: outerEnd + 1, Lr: -99, table: 0, W: 0, cx: 0, cz: -(PIPE.s0 + pipeLen / 2), r: pipeLen,
    Htop, inner, wallEnd, meshStepU: 1.0, meshStepV: 0.3,
    cross(av) {
      if (av < inner) return 0;
      if (av < wallEnd) { const d = av - inner; return PIPE.R - Math.sqrt(PIPE.R * PIPE.R - d * d); }
      if (av < deckEnd) return Htop;
      return Math.max(0, Htop - (av - deckEnd) * 0.8);
    },
    fade(u) { return smooth(u / 25) * smooth((pipeLen - u) / 18); },
    offset(x, z) {
      const u = -z - PIPE.s0;
      if (u <= 0 || u >= pipeLen) return 0;
      const av = Math.abs(x);
      if (av < inner || av > outerEnd) return 0;
      return pipe.cross(av) * pipe.fade(u);
    },
    mask() { return 0; },
  };

  // ------------------------------------------------------------- rails
  // each rail: points given as [s, height above snow]; a snow ramp leads onto the start
  const railSpecs = [
    { name: 'Flat Box', kind: 'box', x: -10, pts: [[80, 0.5], [92, 0.5]] },
    { name: 'Flat-Down Rail', kind: 'rail', x: 10, pts: [[100, 0.55], [104, 0.55 + 4 * Math.tan(9 * DEG)], [111, 0.8]] },
    { name: 'Down Rail', kind: 'rail', x: 0, pts: [[138, 0.7], [152, 0.45]] },
    { name: 'Kinked Rail', kind: 'rail', x: -12, pts: [[172, 0.5], [175, 0.5 + 3 * Math.tan(9 * DEG)], [181, 0.6], [185, 0.6]] },
    { name: 'Long Box', kind: 'box', x: 12, pts: [[168, 0.45], [186, 0.45]] },
  ];
  const features = [];
  const rails = railSpecs.map((r) => {
    const H0 = r.pts[0][1] - 0.05;
    const lip = 14;
    const Lr = (2 * H0) / Math.tan(lip * DEG);
    features.push(makeKicker({ name: `${r.name} ramp`, x: r.x, s: r.pts[0][0] - Lr + 0.1, H: H0, lip, land: 70, W: 2.6 }));
    const P = r.pts.map(([s, h]) => ({ x: r.x, y: baseHeight(r.x, -s) + h, z: -s }));
    const segs = [];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz), hl = Math.hypot(dx, dz);
      segs.push({ a, b, len, d: { x: dx / len, y: dy / len, z: dz / len }, hx: dx, hz: dz, hlen: hl * hl, hl });
    }
    return { name: r.name, kind: r.kind, halfW: r.kind === 'box' ? 0.3 : 0.05, mu: r.kind === 'box' ? 0.1 : 0.07, pts: P, segs };
  });

  // ------------------------------------------------------------- kickers
  features.push(
    makeKicker({ name: 'Park S', x: 0, s: 272, H: 1.0, lip: 26, table: 3, land: 16, W: 8, slope: 14 }),
    makeKicker({ name: 'Park M', x: 0, s: 335, H: 1.9, lip: 28, table: 12, land: 18, W: 10, slope: 14 }),
    makeKicker({ name: 'Park L', x: 0, s: 410, H: 2.5, lip: 30, table: 17, land: 20, W: 12, slope: 14 }),
  );
  features.push(pipe);

  function height(x, z) {
    let y = baseHeight(x, z);
    for (const f of features) { const o = f.offset(x, z); if (o > 0) y += o; }
    return y;
  }
  function normal(x, z, out) {
    const e = 0.15;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l; out.y = (2 * e) / l; out.z = -hz / l;
    return out;
  }

  // A real superpipe wall is vertical at the top, so you launch straight up and
  // come back down into the pipe. Our wall stops at 84°, so remove the small
  // outward drift you'd otherwise carry onto the deck.
  function pipeAssist(pos, vel) {
    const u = -pos.z - PIPE.s0;
    if (u < 20 || u > pipeLen - 10) return;
    const av = Math.abs(pos.x);
    if (av < inner + Rs * 0.6 || av > wallEnd + 0.3) return;
    const out = Math.sign(pos.x);
    if (vel.x * out > -0.4) vel.x = -out * 0.4;
  }

  // trees along the edges
  let seed = 99;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trees = [];
  for (let s = 20; s < LENGTH - 20; s += 7) {
    for (const side of [-1, 1]) {
      if (rand() < 0.75) trees.push({ x: side * (36 + rand() * 20), z: -(s + rand() * 5), r: 0.4, h: 6 + rand() * 6 });
    }
  }

  const checkpoints = [
    { x: 0, s: 5, label: 'Drop In' },
    { x: 0, s: 58, label: 'Rail Garden' },
    { x: 0, s: 205, label: 'Tables' },
    { x: 0, s: 480, label: 'Halfpipe' },
    { x: 0, s: 740, label: 'Bottom' },
  ].map((c) => ({ ...c, z: -c.s }));

  return {
    name: 'Terrain Park',
    bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -LENGTH, maxZ: 20 },
    mesh: { x0: -HALF_W, x1: HALF_W, z0: 20, z1: -LENGTH, dx: 2, dz: 2 },
    height, baseHeight, normal, features, rails, trees, rocks: [], checkpoints,
    powder: () => 0, pipeAssist,
    treesNear: treeGrid(trees),
  };
}
