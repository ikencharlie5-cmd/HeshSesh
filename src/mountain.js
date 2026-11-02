// Hand-designed freeride mountain. Downhill is -Z; s = -z = distance down the hill.
//
// Layout (looking downhill):
//   * Summit + Powder Bowl (top left) - open, deep snow
//   * Main Run - groomed, snakes down the middle
//   * Cliff Band - right side around s≈600, ~9 m drop with rocky face
//   * West Cliffs - smaller band upper left
//   * Two natural gullies (half-pipe shaped)
//   * Jump Line - four tables, small -> XL, lower left
//   * Booters - natural kickers scattered on the runs
//   * Forest everywhere else, thicker lower down
// Pure JS so the physics tests can run in Node.
import { makeKicker } from './features.js';
import { treeGrid } from './terrain.js';

const DEG = Math.PI / 180;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));

// fall-line pitch (deg) along s
const PROFILE = [[-30, 0], [0, 6], [30, 24], [150, 30], [220, 24], [520, 22], [800, 20], [960, 15],
  [1300, 15], [1420, 8], [1520, 2], [1650, 0]];
const LENGTH = 1600;
const HALF_W = 420;

export function createMountain() {
  // integrate the pitch profile
  const STEP = 0.5, s0 = -40;
  const n = Math.ceil((LENGTH + 100) / STEP);
  const elev = new Float64Array(n + 1);
  let pi = 0;
  const pitch = (s) => {
    while (pi < PROFILE.length - 2 && s > PROFILE[pi + 1][0]) pi++;
    const [a0, p0] = PROFILE[pi], [a1, p1] = PROFILE[pi + 1];
    const t = Math.min(1, Math.max(0, (s - a0) / (a1 - a0)));
    return (p0 + (p1 - p0) * t) * DEG;
  };
  for (let i = 1; i <= n; i++) elev[i] = elev[i - 1] - Math.tan(pitch(s0 + (i - 0.5) * STEP)) * STEP;
  const profileY = (s) => {
    const f = (Math.min(Math.max(s, s0), s0 + n * STEP) - s0) / STEP;
    const i = Math.min(n - 1, Math.floor(f));
    return elev[i] + (elev[i + 1] - elev[i]) * (f - i);
  };

  // ---------------------------------------------------------------- features
  const mainRunX = (s) => 60 * Math.sin(s / 220) + 20 * Math.sin(s / 90);
  const lineX = -150;
  const features = [
    // the Jump Line: four tables, growing
    makeKicker({ name: 'Jump Line S', x: lineX, s: 1000, H: 1.2, lip: 26, table: 6, land: 16, W: 7, slope: 15 }),
    makeKicker({ name: 'Jump Line M', x: lineX, s: 1070, H: 1.9, lip: 28, table: 9, land: 18, W: 9, slope: 15 }),
    makeKicker({ name: 'Jump Line L', x: lineX, s: 1150, H: 2.5, lip: 30, table: 16, land: 20, W: 11, slope: 15 }),
    makeKicker({ name: 'Jump Line XL', x: lineX, s: 1250, H: 3.2, lip: 32, table: 19, land: 22, W: 13, slope: 15 }),
    // natural booters on the runs
    makeKicker({ name: 'Summit Booter', x: 30, s: 70, H: 1.0, lip: 22, land: 45, W: 9 }),
    makeKicker({ name: 'Bowl Lip', x: -190, s: 230, H: 1.6, lip: 26, land: 50, W: 14 }),
    makeKicker({ name: 'Main Run Roller', x: mainRunX(330), s: 330, H: 1.2, lip: 20, land: 40, W: 16 }),
    makeKicker({ name: 'Ridge Booter', x: 150, s: 430, H: 1.8, lip: 28, land: 50, W: 8, yaw: -8 }),
    makeKicker({ name: 'Side Hit', x: mainRunX(520) + 30, s: 520, H: 1.4, lip: 30, land: 50, W: 6, yaw: 10 }),
    makeKicker({ name: 'Cliff Kicker', x: 200, s: 588, H: 1.0, lip: 18, land: 60, W: 10 }),
    makeKicker({ name: 'Main Run Booter', x: mainRunX(760), s: 760, H: 1.6, lip: 24, land: 45, W: 12 }),
    makeKicker({ name: 'Glade Pop', x: 240, s: 880, H: 1.3, lip: 26, land: 50, W: 7 }),
    makeKicker({ name: 'Lower Booter', x: mainRunX(1180), s: 1180, H: 2.0, lip: 26, land: 45, W: 12 }),
    makeKicker({ name: 'Base Kicker', x: 0, s: 1440, H: 1.4, lip: 24, table: 4, land: 18, W: 10, slope: 7 }),
  ];
  const featureMask = (x, z) => { let m = 0; for (const f of features) m = Math.max(m, f.mask(x, z)); return m; };

  const gullies = [
    { x0: 120, amp: 25, wl: 90, w: 13, D: 7, s0: 950, s1: 1380 },
    { x0: -300, amp: 20, wl: 70, w: 11, D: 6, s0: 320, s1: 820 },
  ];
  const cliffs = [
    { s: 600, x0: 90, x1: 310, H: 9 },
    { s: 330, x0: -340, x1: -215, H: 6 },
  ];
  const powderZones = [
    { x: -240, s: 140, r: 130 },
    { x: 260, s: 930, r: 120 },
    { x: -320, s: 1100, r: 80 },
  ];

  // ---------------------------------------------------------------- height
  function rawHeight(x, z) {
    const s = -z;
    let y = profileY(s);
    const ax = Math.abs(x);
    y += 0.00018 * x * x + Math.max(0, ax - 340) ** 2 * 0.004;      // gentle funnel, sides roll up
    y += 22 * Math.exp(-(((s + 20) / 110) ** 2)) * (1 - Math.exp(-((x / 170) ** 2))); // summit ridge around the bowl
    // big rolls (always) + small rolls (calmed under features)
    y += 6 * Math.sin(x / 61 + s / 97) * Math.sin(s / 83 + 0.4);
    const calm = 1 - featureMask(x, z);
    y += calm * (2.6 * Math.sin(x / 29 - s / 41) + 0.9 * Math.sin(x / 13 + s / 17) * Math.sin(s / 23));
    // groomed main run: flatten the cross-slope a little
    for (const g of gullies) {
      const fade = smoothstep(g.s0, g.s0 + 40, s) * (1 - smoothstep(g.s1 - 40, g.s1, s));
      if (fade <= 0) continue;
      const gx = g.x0 + g.amp * Math.sin(s / g.wl);
      y -= g.D * fade * Math.exp(-(((x - gx) / g.w) ** 2));
    }
    for (const c of cliffs) {
      const mx = smoothstep(c.x0 - 30, c.x0, x) * (1 - smoothstep(c.x1, c.x1 + 30, x));
      if (mx > 0) y -= c.H * mx * smoothstep(c.s, c.s + 3.5, s);
    }
    return y;
  }

  // the jump line is groomed flat across, like a real park lane
  function baseHeight(x, z) {
    const y = rawHeight(x, z);
    const s = -z, dx = Math.abs(x - lineX);
    if (s < 900 || s > 1380 || dx > 45) return y;
    const w = (1 - smoothstep(22, 45, dx)) * smoothstep(900, 940, s) * (1 - smoothstep(1340, 1380, s));
    return y + (rawHeight(lineX, z) - y) * w;
  }

  function height(x, z) {
    let y = baseHeight(x, z);
    for (const f of features) { const o = f.offset(x, z); if (o > 0) y += o; }
    return y;
  }

  function normal(x, z, out) {
    const e = 0.2;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l; out.y = (2 * e) / l; out.z = -hz / l;
    return out;
  }

  function powder(x, z) {
    const s = -z;
    let p = 0;
    for (const q of powderZones) {
      const d = Math.hypot(x - q.x, s - q.s);
      p = Math.max(p, 1 - smoothstep(q.r * 0.6, q.r, d));
    }
    return p;
  }

  // ---------------------------------------------------------------- trees
  let seed = 4242;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trees = [];
  for (let s = 40; s < LENGTH - 30; s += 8) {
    for (let x = -HALF_W + 20; x < HALF_W - 20; x += 8) {
      const px = x + (rand() - 0.5) * 7, ps = s + (rand() - 0.5) * 7;
      // keep runs, the bowl, the jump line and features clear
      if (Math.abs(px - mainRunX(ps)) < 42) continue;
      if (Math.abs(px - lineX) < 34 && ps > 900 && ps < 1350) continue;
      if (Math.hypot(px + 240, ps - 140) < 120) continue;          // powder bowl is open
      if (ps < 120 && Math.abs(px) < 260) continue;                 // summit area
      if (ps > 1420) continue;                                       // base area
      if (featureMask(px, -ps) > 0) continue;
      let nearFeature = false;
      for (const f of features) if (Math.hypot(px - f.cx, -ps - f.cz) < f.r + 6) { nearFeature = true; break; }
      if (nearFeature) continue;
      // density: treeline lower down, clumpy glades
      const clump = 0.5 + 0.5 * Math.sin(px / 37 + ps / 53) * Math.sin(ps / 41 - px / 71);
      const treeline = smoothstep(120, 380, ps);
      const p = treeline * (0.08 + 0.42 * clump) * (powder(px, -ps) > 0.3 ? 0.35 : 1);
      if (rand() < p) trees.push({ x: px, z: -ps, r: 0.4, h: 6 + rand() * 7 });
    }
  }

  // rocks along cliff faces and a few boulders
  const rocks = [];
  for (const c of cliffs) {
    for (let x = c.x0 - 10; x < c.x1 + 10; x += 2.5 + rand() * 3) {
      rocks.push({ x, z: -(c.s + 1.8 + rand() * 1.2), size: 1.6 + rand() * 2.4 });
    }
  }

  const checkpoints = [
    { x: 0, s: 38, label: 'Summit' },
    { x: -200, s: 60, label: 'Powder Bowl' },
    { x: mainRunX(400), s: 400, label: 'Main Run' },
    { x: 200, s: 545, label: 'Cliff Band' },
    { x: lineX, s: 955, label: 'Jump Line' },
    { x: 120 + 25 * Math.sin(1000 / 90), s: 1000, label: 'Gully' },
    { x: 0, s: 1400, label: 'Base' },
  ].map((c) => ({ ...c, z: -c.s }));

  return {
    name: 'Mountain',
    bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -LENGTH - 20, maxZ: 25 },
    mesh: { x0: -HALF_W, x1: HALF_W, z0: 25, z1: -LENGTH - 20, dx: 4, dz: 4 },
    height, baseHeight, normal, powder, features, trees, rocks, checkpoints,
    treesNear: treeGrid(trees),
    profileY,
  };
}
