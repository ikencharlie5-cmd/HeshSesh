// Test slope terrain.
//
// The terrain is an analytic height function h(x, z) so physics can sample it
// exactly (no mesh raycasts). Downhill is the -Z direction; "s" = -z is the
// distance down the run. The long profile is built from a pitch table that is
// integrated once into an elevation lookup, then a lateral bowl and gentle
// rolls are added on top.
//
// Pure JS (no Three.js import) so the physics can be tested headless in Node.

const DEG = Math.PI / 180;

// [s (m down the run), pitch in degrees (+ = downhill, - = uphill)]
// Pitch is linearly interpolated between points, so two points close together
// make a sharp break (used for the kicker lip and knuckle).
const PROFILE = [
  [0, 0], [20, 0],                  // start platform
  [40, 20], [60, 28], [170, 30],    // steep pitch
  [200, 22], [230, 12], [260, 10],  // rollover into mellow
  [395, 10],                        // long mellow approach (speed check)
  [405, 5], [415, -25],             // kicker ramp (concave transition, 25° lip)
  [415.6, 0], [421, 0],             // short table (knuckling = flat landing)
  [422, 30], [510, 30],             // 30° landing
  [560, 14], [600, 10],             // runout
  [640, 10], [652, -6], [660, 14], [690, 9], // natural roller to pop off
  [760, 6], [800, 0],               // flats
  [840, 0], [860, -7], [900, -7],   // uphill: bleed off speed
  [920, 0], [980, 0],
];

const STEP = 0.25;

export function createSlopeTerrain() {
  const length = PROFILE[PROFILE.length - 1][0];
  const halfWidth = 70;
  const n = Math.ceil(length / STEP) + 1;
  const elev = new Float32Array(n);

  // integrate pitch -> elevation
  let pi = 0;
  const pitchAt = (s) => {
    while (pi < PROFILE.length - 2 && s > PROFILE[pi + 1][0]) pi++;
    const [s0, p0] = PROFILE[pi];
    const [s1, p1] = PROFILE[pi + 1];
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
    return (p0 + (p1 - p0) * t) * DEG;
  };
  elev[0] = 0;
  for (let i = 1; i < n; i++) {
    const sm = (i - 0.5) * STEP;
    elev[i] = elev[i - 1] - Math.tan(pitchAt(sm)) * STEP;
  }

  const profileY = (s) => {
    if (s <= 0) return elev[0];
    const f = s / STEP;
    const i = Math.floor(f);
    if (i >= n - 1) return elev[n - 1];
    const t = f - i;
    return elev[i] + (elev[i + 1] - elev[i]) * t;
  };

  // Keep the kicker area clean of rolls so the lip is exactly as designed.
  const rollWeight = (s) => {
    const d = Math.min(Math.abs(s - 415), Math.abs(s - 655));
    return Math.min(1, Math.max(0, (d - 25) / 25));
  };

  function height(x, z) {
    const s = -z;
    const ax = Math.abs(x);
    // lateral bowl: flat-ish middle, walls rise toward the edges
    const bowl = 0.0016 * x * x + Math.max(0, ax - 45) ** 2 * 0.02;
    const rolls = 0.55 * Math.sin(x * 0.07 + s * 0.021) * Math.sin(s * 0.043 + 1.3) +
                  0.25 * Math.sin(x * 0.17 - s * 0.05);
    return profileY(s) + bowl + rolls * rollWeight(s);
  }

  function normal(x, z, out) {
    const e = 0.2;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    // n = (-dh/dx, 1, -dh/dz) normalized (2e factor folded in)
    let nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // Trees: dense along the walls, a few in the mellow section as obstacles.
  const trees = [];
  let seed = 1234;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let s = 30; s < length - 10; s += 6) {
    for (const side of [-1, 1]) {
      const count = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < count; k++) {
        const x = side * (40 + rand() * 28);
        const zz = -(s + rand() * 6);
        trees.push({ x, z: zz, r: 0.45, h: 6 + rand() * 6 });
      }
    }
  }
  for (const [s, x] of [[280, -12], [300, 15], [318, 7], [345, -20], [365, 18], [700, -8], [730, 14]]) {
    trees.push({ x, z: -s, r: 0.45, h: 7 + rand() * 3 });
  }

  const checkpoints = [
    { s: 24, label: 'Top' },
    { s: 262, label: 'Mellow' },
    { s: 560, label: 'Runout' },
    { s: 760, label: 'Flats' },
  ];

  return {
    name: 'Test Slope',
    length, halfWidth,
    bounds: { minX: -halfWidth, maxX: halfWidth, minZ: -(length - 2), maxZ: 15 },
    mesh: { x0: -halfWidth, x1: halfWidth, z0: 20, z1: -length - 20, dx: 2.5, dz: 1 },
    height, baseHeight: height, normal, trees, features: [], rocks: [],
    checkpoints: checkpoints.map((c) => ({ ...c, x: 0, z: -c.s })),
    treesNear: treeGrid(trees),
    pitchAt: (s) => { pi = 0; return pitchAt(s); },
    powder: () => 0, // fraction 0..1 of powder at a location (none on the test slope)
  };
}

// Spatial hash so tree collision checks only look at nearby trees.
export function treeGrid(trees, cell = 10) {
  const grid = new Map();
  for (const t of trees) {
    const k = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(t);
  }
  const out = [];
  return (x, z) => {
    out.length = 0;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = grid.get(`${cx + i},${cz + j}`);
      if (l) for (const t of l) out.push(t);
    }
    return out;
  };
}
