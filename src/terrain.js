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
    height, normal, trees, checkpoints,
    pitchAt: (s) => { pi = 0; return pitchAt(s); },
    powder: () => 0, // fraction 0..1 of powder at a location (none on the test slope)
  };
}

// Build the visual mesh. THREE is passed in so this file stays Node-importable.
export function buildTerrainMesh(THREE, terrain) {
  const { length, halfWidth } = terrain;
  const dz = 1.0, dx = 2.5;
  const nx = Math.round((halfWidth * 2) / dx) + 1;
  const nz = Math.round((length + 40) / dz) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const nrm = { x: 0, y: 1, z: 0 };
  let p = 0;
  for (let j = 0; j < nz; j++) {
    const z = 20 - j * dz;
    for (let i = 0; i < nx; i++) {
      const x = -halfWidth + i * dx;
      const y = terrain.height(x, z);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      terrain.normal(x, z, nrm);
      // steeper = slightly bluer/darker snow, helps read the slope
      const steep = 1 - nrm.y;
      // a little per-vertex grain so speed and terrain shape read in motion
      const grain = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 * 0.05;
      const shade = 0.95 - steep * 1.3 + grain;
      col[p] = shade * 0.9; col[p + 1] = shade * 0.95; col[p + 2] = Math.min(1, shade * 1.03 + 0.04);
      p += 3;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // counter-clockwise seen from above (+y) so faces point up
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);

  const group = new THREE.Group();
  group.add(mesh);

  // trees as two instanced meshes (trunk + canopy) = 2 draw calls
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.ConeGeometry(1, 1, 6);
  canopyGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3d2b, flatShading: true }), terrain.trees.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0x2f5d3a, flatShading: true }), terrain.trees.length);
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  terrain.trees.forEach((t, i) => {
    const y = terrain.height(t.x, t.z) - 0.3;
    ps.set(t.x, y, t.z); sc.set(1, t.h * 0.3, 1); m.compose(ps, qt, sc); trunks.setMatrixAt(i, m);
    ps.set(t.x, y + t.h * 0.22, t.z); sc.set(t.h * 0.28, t.h * 0.85, t.h * 0.28); m.compose(ps, qt, sc); canopies.setMatrixAt(i, m);
  });
  group.add(trunks, canopies);

  // checkpoint flags
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4); poleGeo.translate(0, 1.2, 0);
  const flagGeo = new THREE.PlaneGeometry(1.0, 0.6); flagGeo.translate(0.5, 2.1, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide });
  for (const cp of terrain.checkpoints) {
    for (const x of [-14, 14]) {
      const z = -cp.s;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, terrain.height(x, z), z);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.copy(pole.position);
      if (x > 0) flag.rotation.y = Math.PI;
      group.add(pole, flag);
    }
  }
  return group;
}
