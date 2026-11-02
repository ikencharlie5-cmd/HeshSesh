// Builds everything you see for a terrain: snow surface, snow features with
// dyed lip lines, frosted trees, rocks, checkpoint flags and a distant range.
import * as THREE from 'three';

const SNOW = new THREE.Color().setRGB(0.95, 0.97, 1.0, THREE.SRGBColorSpace);
const SNOW_SHADE = new THREE.Color().setRGB(0.83, 0.88, 0.97, THREE.SRGBColorSpace);
const POWDER = new THREE.Color().setRGB(0.99, 0.995, 1.0, THREE.SRGBColorSpace);
const ROCK = new THREE.Color().setRGB(0.42, 0.43, 0.47, THREE.SRGBColorSpace);
const ROCK_DARK = new THREE.Color().setRGB(0.3, 0.31, 0.35, THREE.SRGBColorSpace);
const DYE = new THREE.Color().setRGB(0.15, 0.45, 0.95, THREE.SRGBColorSpace);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function snowColor(out, steep, powder, grain) {
  // steep faces go blue-grey, very steep becomes rock
  out.copy(SNOW).lerp(SNOW_SHADE, smooth(steep * 3));
  if (powder > 0) out.lerp(POWDER, powder * 0.7);
  const rock = smooth((steep - 0.3) / 0.15);
  if (rock > 0) out.lerp(grain > 0 ? ROCK : ROCK_DARK, rock);
  out.offsetHSL(0, 0, grain * 0.02);
  return out;
}

function gridMesh(nx, nz, vertex, material, normalFn = null) {
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0, p = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++, p += 3) vertex(i, j, pos, col, p, c);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = cc; idx[q++] = b; idx[q++] = d; idx[q++] = cc;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (normalFn) {
    // analytic normals: no lighting seams between neighbouring tiles
    const nor = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) {
      const n = normalFn(pos[k * 3], pos[k * 3 + 2]);
      nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  } else geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

const hash = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h) - 0.5; };

export function buildWorld(terrain) {
  const group = new THREE.Group();
  const M = terrain.mesh;
  const snowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const nrm = { x: 0, y: 1, z: 0 };
  const powderAt = terrain.powder || (() => 0);

  // ---- base snow surface (features are drawn separately on top)
  const nx = Math.round((M.x1 - M.x0) / M.dx) + 1, nz = Math.round((M.z0 - M.z1) / M.dz) + 1;
  const base = terrain.baseHeight;
  const baseNormal = (x, z) => {
    const e = M.dx * 0.5;
    const hx = base(x + e, z) - base(x - e, z), hz = base(x, z + e) - base(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    nrm.x = -hx / l; nrm.y = 2 * e / l; nrm.z = -hz / l;
    return nrm;
  };
  const TILE = 25; // cells per tile side
  for (let tj = 0; tj < nz - 1; tj += TILE) {
    for (let ti = 0; ti < nx - 1; ti += TILE) {
      const tnx = Math.min(TILE, nx - 1 - ti) + 1, tnz = Math.min(TILE, nz - 1 - tj) + 1;
      const tile = gridMesh(tnx, tnz, (i, j, pos, col, p, c) => {
        const x = M.x0 + (ti + i) * M.dx, z = M.z0 - (tj + j) * M.dz;
        pos[p] = x; pos[p + 1] = base(x, z); pos[p + 2] = z;
        const n = baseNormal(x, z);
        snowColor(c, 1 - n.y, powderAt(x, z), hash(x, z));
        col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
      }, snowMat, (x, z) => baseNormal(x, z));
      tile.receiveShadow = true;
      group.add(tile);
    }
  }

  // ---- features: fine local meshes, lifted a hair, with blue dye on lips and knuckles
  const featMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const f of terrain.features) {
    const step = 0.4;
    const nu = Math.ceil((f.L + 2) / step) + 1, nv = Math.ceil((2 * f.reach + 2) / step) + 1;
    const mesh = gridMesh(nv, nu, (i, j, pos, col, p, c) => {
      const u = -1 + j * step, v = -(f.reach + 1) + i * step;
      const x = f.x0 + f.a.x * u + f.b.x * v, z = f.z0 + f.a.z * u + f.b.z * v;
      const o = f.offset(x, z);
      pos[p] = x; pos[p + 1] = terrain.height(x, z) + 0.02; pos[p + 2] = z;
      terrain.normal(x, z, nrm);
      snowColor(c, 1 - nrm.y, 0, hash(x, z) * 0.5);
      const lipLine = u > f.Lr - 0.5 && u < f.Lr && Math.abs(v) < f.W / 2;
      const knuckle = f.table > 0 && u > f.Lr + f.table - 0.25 && u < f.Lr + f.table + 0.25 && Math.abs(v) < f.W / 2;
      if (lipLine || knuckle) c.lerp(DYE, 0.85);
      if (o <= 0) c.copy(SNOW);
      col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
    }, featMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- trees: one merged, vertex-colored geometry instanced (trunk + 3 frosted tiers)
  if (terrain.trees.length) group.add(buildTrees(terrain));
  if (terrain.rocks && terrain.rocks.length) group.add(buildRocks(terrain));

  // ---- checkpoint flags
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5).translate(0, 1.2, 0);
  const flagGeo = new THREE.PlaneGeometry(1.0, 0.6).translate(0.5, 2.1, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide });
  for (const cp of terrain.checkpoints) {
    for (const dx of [-7, 7]) {
      const x = cp.x + dx, z = cp.z;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, terrain.height(x, z), z);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.copy(pole.position);
      if (dx > 0) flag.rotation.y = Math.PI;
      group.add(pole, flag);
    }
  }

  group.add(buildRange(terrain));
  return group;
}

function mergeColored(parts) {
  // parts: [geometry, THREE.Color | (y) => Color]
  const pos = [], col = [], nor = [];
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const c = typeof color === 'function' ? color(p.getY(i)) : color;
      col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function buildTrees(terrain) {
  const trunk = new THREE.Color().setRGB(0.36, 0.25, 0.18, THREE.SRGBColorSpace);
  const green = new THREE.Color().setRGB(0.16, 0.33, 0.24, THREE.SRGBColorSpace);
  const frost = new THREE.Color().setRGB(0.9, 0.94, 0.98, THREE.SRGBColorSpace);
  const tier = (y0, h, r) => {
    const g = new THREE.ConeGeometry(r, h, 7).translate(0, y0 + h / 2, 0);
    return [g, (y) => { const t = (y - y0) / h; return green.clone().lerp(frost, smooth((t - 0.55) / 0.45) * 0.85); }];
  };
  const geo = mergeColored([
    [new THREE.CylinderGeometry(0.06, 0.1, 0.25, 5).translate(0, 0.125, 0), trunk],
    tier(0.15, 0.45, 0.32), tier(0.4, 0.38, 0.25), tier(0.62, 0.38, 0.17),
  ]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const chunks = new Map();
  for (const t of terrain.trees) {
    const k = `${Math.floor(t.x / 200)},${Math.floor(t.z / 200)}`;
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(t);
  }
  const out = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const list of chunks.values()) {
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, (t.x * 7.31 + t.z * 3.17) % 6.28);
      p.set(t.x, terrain.height(t.x, t.z) - 0.3, t.z);
      s.set(t.h * 0.95, t.h, t.h * 0.95);
      m.compose(p, q, s); inst.setMatrixAt(i, m);
    });
    inst.computeBoundingSphere(); // so the chunk can be frustum-culled
    out.add(inst);
  }
  return out;
}

function buildRocks(terrain) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x6d7079, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, terrain.rocks.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  terrain.rocks.forEach((r, i) => {
    e.set(r.x * 1.3, r.z * 0.7, r.x * 0.37); q.setFromEuler(e);
    p.set(r.x, terrain.height(r.x, r.z) - r.size * 0.2, r.z);
    s.set(r.size, r.size * 0.8, r.size * 0.9);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  });
  return inst;
}

// Distant mountain range around the playable area. It starts at exactly the
// play area's edge height (so there is no seam) and rises into peaks.
function buildRange(terrain) {
  const B = terrain.mesh;
  const ext = 2600, step = 90;
  const xs = [], zs = [];
  for (let x = B.x0 - ext; x <= B.x1 + ext; x += step) xs.push(x);
  for (let z = B.z0 + 900; z >= B.z1 - ext; z -= step) zs.push(z);
  xs.push(B.x0, B.x1); zs.push(B.z0, B.z1);
  xs.sort((a, b) => a - b); zs.sort((a, b) => b - a);
  const ridge = (x, z) => {
    const r = Math.abs(Math.sin(x / 310 + Math.sin(z / 420))) * 0.55 + Math.abs(Math.sin(z / 230 - x / 510)) * 0.35
      + Math.abs(Math.sin(x / 97 + z / 131)) * 0.1;
    return r * r;
  };
  const h = (x, z) => {
    const cx = Math.min(Math.max(x, B.x0), B.x1), cz = Math.min(Math.max(z, B.z1), B.z0);
    const d = Math.hypot(x - cx, z - cz);
    const edge = terrain.baseHeight(cx, cz);
    return edge + smooth(d / 500) * (60 + 520 * ridge(x, z)) + d * 0.08;
  };
  const inside = (x, z) => x > B.x0 + 1 && x < B.x1 - 1 && z < B.z0 - 1 && z > B.z1 + 1;
  const pos = [], col = [];
  const c = new THREE.Color();
  const hgt = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) hgt.push(h(xs[i], zs[j]));
  const idx = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
    const x = xs[i], z = zs[j], y = hgt[j * xs.length + i];
    pos.push(x, y, z);
    // snowy peaks, rocky steeps (estimated from neighbour heights)
    const yr = i + 1 < xs.length ? hgt[j * xs.length + i + 1] : y;
    const steep = Math.abs(yr - y) / step;
    snowColor(c, Math.min(0.6, steep * 0.6), 0, hash(x, z));
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (inside(cx, cz)) continue; // the play mesh covers this
    const a = j * xs.length + i, b = a + 1, cc = a + xs.length, d = cc + 1;
    idx.push(a, b, cc, b, d, cc);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  return mesh;
}
