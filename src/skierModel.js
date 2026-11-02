// Low-poly skier, posed procedurally from physics state each frame.
//
// The pose is a set of joints in a local frame (x = skier's LEFT, y up,
// z forward). Each body segment is a small group of shaped meshes hung
// between two joints. The ragdoll reuses the exact same segments with world-space
// joints, so a crash tumbles the same character.
//
// Outfit: baggy flared cargo pants, oversized black shell jacket with a
// blaze-orange hood, matte helmet + mirrored goggles + face gaiter, chunky
// gloves and boots, twin-tip skis.
import * as THREE from 'three';

const JOINTS = ['head', 'chest', 'hip', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lFoot', 'rFoot',
  'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand', 'lTip', 'rTip', 'lTail', 'rTail'];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));

// Segments: [name, fromJoint, toJoint, nominal length]. Constraints for the ragdoll come from these too.
export const SEGMENTS = [
  ['torso', 'hip', 'chest', 0.52],
  ['head', 'chest', 'head', 0.2],
  ['pelvis', 'rHip', 'lHip', 0.2],
  ['thighL', 'lHip', 'lKnee', 0.46], ['thighR', 'rHip', 'rKnee', 0.46],
  ['shinL', 'lKnee', 'lFoot', 0.46], ['shinR', 'rKnee', 'rFoot', 0.46],
  ['upperArmL', 'lShoulder', 'lElbow', 0.3], ['upperArmR', 'rShoulder', 'rElbow', 0.3],
  ['forearmL', 'lElbow', 'lHand', 0.28], ['forearmR', 'rElbow', 'rHand', 0.28],
  ['skiL', 'lTail', 'lTip', 1.72], ['skiR', 'rTail', 'rTip', 1.72],
];
// extra structural links the ragdoll needs (shoulders hang off the chest)
export const LINKS = [
  ['chest', 'lShoulder'], ['chest', 'rShoulder'], ['lShoulder', 'rShoulder'],
  ['hip', 'lShoulder'], ['hip', 'rShoulder'],
];

// smooth-shaded clothing reads as fabric; flat shading is kept for hard gear
const soft = (color) => new THREE.MeshLambertMaterial({ color });
const hard = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
export const MATERIALS = {
  jacket: soft(0x26292f),       // black puffer shell
  jacketSeam: soft(0x15171b),
  jacketTrim: soft(0xff5a14),   // blaze orange
  zip: soft(0x4a4f57),
  pants: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), // baggy tan cargo, shaded folds
  pantsDark: soft(0x7d6640),
  pantsSeam: soft(0x6a5636),
  button: soft(0x2a2a2a),
  glove: soft(0x17181b),
  boot: hard(0xe9ecef),
  bootDark: hard(0x2a2d33),
  helmet: new THREE.MeshPhongMaterial({ color: 0xeeeeea, shininess: 25, specular: 0x333333 }),
  strap: soft(0x15171b),
  gaiter: soft(0x1c1e22),
  lens: new THREE.MeshPhongMaterial({ color: 0xff7a1a, emissive: 0x401800, specular: 0xffffff, shininess: 120 }),
  frame: soft(0x111214),
  skiTop: hard(0xf3d23a),
  skiBase: hard(0x15171a),
  pole: hard(0x2b2e33),
  basket: hard(0x111214),
};

// --------------------------------------------------------------- geometry
// Lathe a radius profile [[y, r], ...] around +Y, then squash x/z for an oval section.
function lathe(profile, sx = 1, sz = 1, seg = 8) {
  const g = new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(r, y)), seg);
  g.scale(sx, 1, sz);
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function skiGeometry(len) {
  // twin tip: a flat plank (Y = length, Z = up off the base, X = width) with both ends turned up
  const W = 0.105, T = 0.022, n = 16;
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = t * len;
    const e = Math.min(t, 1 - t) * len;               // distance from nearest end
    const lift = e < 0.22 ? (0.22 - e) ** 2 * 1.6 : 0;   // upturn
    const w = W * (e < 0.08 ? 0.75 + e * 3 : 1);
    for (const [x, z] of [[-w / 2, lift], [w / 2, lift], [w / 2, lift + T], [-w / 2, lift + T]]) pos.push(x, y, z);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = a + 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
    }
  }
  idx.push(0, 1, 2, 0, 2, 3);
  const e = n * 4; idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Each builder returns a Group whose local +Y runs from joint A to joint B (nominal length)
// and whose local +Z is the "front" hint (body front / ski top).
// ------------------------------------------------------------- fabric
const PANTS = new THREE.Color(0xa88d5c);
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// A cloth tube hung along +Y (down the leg). radius(t) gives the silhouette,
// fold(t, θ) pushes the surface in/out for wrinkles, drop(t, θ) lets a hem
// hang lower at the back. Vertex colors darken the fold valleys so the folds
// read as fabric instead of a smooth pipe.
function fabricTube(L, { t0, t1, rings, radius, fold, drop = () => 0, sx = 1, sz = 1, zoff = () => 0, hem = false }) {
  const seg = 18, pos = [], col = [], idx = [];
  const c = new THREE.Color();
  const ringCount = rings + (hem ? 1 : 0);
  for (let i = 0; i <= rings; i++) {
    const t = t0 + (t1 - t0) * (i / rings);
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const f = fold(t, th);
      const r = radius(t) * (1 + f);
      pos.push(Math.sin(th) * r * sx, t * L + drop(t, th), Math.cos(th) * r * sz + zoff(t));
      const back = Math.max(0, -Math.cos(th)) * 0.06;
      c.copy(PANTS).multiplyScalar(0.8 + 2.2 * f + 0.12 - back);
      col.push(c.r, c.g, c.b);
    }
  }
  if (hem) { // turn the bottom edge inward so the cuff has thickness
    const t = t1;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const r = radius(t) * 0.82;
      pos.push(Math.sin(th) * r * sx, t * L + drop(t, th) - 0.01, Math.cos(th) * r * sz + zoff(t));
      c.copy(PANTS).multiplyScalar(0.55); col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < ringCount; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function tint(geo, k) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  const c = PANTS.clone().multiplyScalar(k);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// cargo pocket on the outside of the thigh: bellows body, flap, snap, side pleat
function cargoPocket(side, r, y) {
  const p = new THREE.Group();
  const x = side * (r + 0.012);
  p.add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.17, 0.15).translate(x, y, 0.005), MATERIALS.pantsDark));
  p.add(new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.05, 0.16).translate(x + side * 0.005, y - 0.09, 0.005), MATERIALS.pantsDark));
  p.add(new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4).translate(x + side * 0.03, y - 0.085, 0.005), MATERIALS.button));
  p.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.008).translate(x, y + 0.005, 0.078), MATERIALS.pantsSeam));
  p.rotation.y = side * 0.08;
  return p;
}

const cap = (r, len, seg = 12) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, seg);
const BUILDERS = {
  torso(L) {
    const g = new THREE.Group();
    // puffy shell: a squashed capsule whose bottom cap hangs over the hips
    // straight-cut puffer: long body with a flat hem that hangs over the seat
    g.add(new THREE.Mesh(lathe([[-0.27, 0], [-0.27, 0.212], [-0.2, 0.218], [L - 0.2, 0.218], [L - 0.08, 0.205], [L + 0.0, 0.16], [L + 0.05, 0]], 1.17, 0.95, 18), MATERIALS.jacket));
    for (const y of [-0.1, 0.06, 0.22]) { // quilted puffer seams
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.219, 0.01, 5, 18).rotateX(Math.PI / 2).translate(0, y, 0).scale(1.17, 1, 0.95), MATERIALS.jacketSeam));
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.222, 0.222, 0.05, 18, 1, true).translate(0, -0.245, 0).scale(1.17, 1, 0.95), MATERIALS.jacketTrim)); // hem band
    g.add(new THREE.Mesh(box(0.014, L + 0.08, 0.02, 0, (L - 0.14) / 2, 0.198), MATERIALS.zip));
    // hood bunched behind the neck + tall collar
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8).scale(1.25, 0.7, 0.85).translate(0, L + 0.02, -0.13), MATERIALS.jacketTrim));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 12).translate(0, L + 0.03, 0), MATERIALS.jacket));
    return g;
  },
  head() {
    const g = new THREE.Group();
    const c = 0.21; // head center at the end of the neck segment
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.16, 12).translate(0, c - 0.08, 0.005), MATERIALS.gaiter));
    // big round helmet with a short brim
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 0.98, 1.08).translate(0, c - 0.02, -0.01), MATERIALS.helmet));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 16, 1, false, -0.9, 1.8).translate(0, c + 0.075, 0.0), MATERIALS.helmet));
    // goggles: strap round the helmet, chunky frame, mirrored orange lens
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.183, 0.183, 0.05, 20, 1, true).translate(0, c + 0.005, -0.01), MATERIALS.strap));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.105, 20, 1, true, -1.15, 2.3).translate(0, c + 0.0, 0), MATERIALS.frame));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.196, 0.196, 0.08, 20, 1, true, -1.02, 2.04).translate(0, c + 0.0, 0), MATERIALS.lens));
    return g;
  },
  pelvis(L) {
    // baggy dropped seat. In this group +Y runs right hip -> left hip and +X points DOWN.
    const g = new THREE.Group();
    g.add(new THREE.Mesh(tint(new THREE.SphereGeometry(0.18, 18, 14).scale(1.0, 1.0, 0.85).translate(0.07, L / 2, 0.02), 0.9), MATERIALS.pants));
    // low crotch bridging the legs
    g.add(new THREE.Mesh(tint(new THREE.SphereGeometry(0.12, 14, 10).scale(1.2, 1.45, 0.9).translate(0.18, L / 2, 0.02), 0.78), MATERIALS.pants));
    return g;
  },
  thigh(L, side) {
    // +Y runs down the leg, +X is the skier's right
    const g = new THREE.Group();
    g.add(new THREE.Mesh(fabricTube(L, {
      t0: -0.18, t1: 1.14, rings: 26,
      radius: (t) => (0.158 - 0.016 * sm(t)) * Math.sqrt(Math.max(0.02, 1 - sm((t - 1.0) / 0.14) * 0.98)),
      // loose fabric everywhere, diagonal creases bunching behind and above the knee
      fold: (t, th) => 0.025 * Math.sin(5 * th - 3 * t) + 0.045 * Math.sin(3 * th + 11 * t) * sm((t - 0.5) / 0.4)
        + 0.03 * Math.sin(2 * th + 6) * sm((t - 0.85) / 0.2),
      sx: 1.0, sz: 1.08, zoff: (t) => 0.012 * sm((t - 0.6) / 0.4),
    }), MATERIALS.pants));
    g.add(cargoPocket(side, 0.15, L * 0.5));
    // outside seam
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, L * 0.95, 0.012).translate(side * 0.157, L * 0.47, 0), MATERIALS.pantsSeam));
    return g;
  },
  shin(L, side) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(fabricTube(L, {
      t0: -0.12, t1: 1.16, rings: 30, hem: true,
      // straight wide leg that keeps getting wider down to the boot
      radius: (t) => (0.142 + 0.02 * sm(t / 0.5) + 0.03 * sm((t - 0.5) / 0.45) + 0.012 * sm((t - 1.0) / 0.16)) * (1 - 0.25 * sm(-t / 0.12)),
      // stacking: the extra length piles up in wavy rings over the boot
      fold: (t, th) => 0.022 * Math.sin(4 * th + 7 * t)
        + 0.075 * Math.pow(0.5 + 0.5 * Math.sin(t * L * 40 + 1.6 * Math.sin(2 * th + t * 3)), 2) * sm((t - 0.6) / 0.25) * (1 - 0.6 * sm((t - 1.08) / 0.08)),
      // hem drags lower at the heel
      drop: (t, th) => 0.06 * Math.max(0, -Math.cos(th)) * sm((t - 1.0) / 0.16),
      sx: 1.02, sz: 1.1, zoff: (t) => 0.01 * sm((t - 0.7) / 0.4),
    }), MATERIALS.pants));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, L * 0.7, 0.012).translate(side * 0.16, L * 0.35, 0), MATERIALS.pantsSeam));
    return g;
  },
  upperArm(L) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cap(0.09, L).translate(0, L / 2, 0), MATERIALS.jacket));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.01, 5, 12).rotateX(Math.PI / 2).translate(0, L * 0.5, 0), MATERIALS.jacketSeam));
    return g;
  },
  forearm(L) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cap(0.085, L * 0.8).translate(0, L * 0.4, 0), MATERIALS.jacket));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.09, 0.05, 12).translate(0, L * 0.82, 0), MATERIALS.jacketTrim));
    // chunky mitt with thumb
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8).scale(1, 1.25, 0.85).translate(0, L + 0.03, 0), MATERIALS.glove));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.4, 1).translate(0.05, L, 0.04), MATERIALS.glove));
    return g;
  },
  ski(L) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(skiGeometry(L), MATERIALS.skiTop));
    g.add(new THREE.Mesh(skiGeometry(L).scale(1.02, 1, 0.35), MATERIALS.skiBase));
    // boot + binding at the mount point (foot sits 0.75 m from the tail)
    const m = 0.75;
    g.add(new THREE.Mesh(box(0.075, 0.34, 0.03, 0, m, 0.035), MATERIALS.bootDark));
    g.add(new THREE.Mesh(box(0.115, 0.31, 0.11, 0, m - 0.01, 0.1), MATERIALS.boot));
    g.add(new THREE.Mesh(box(0.115, 0.12, 0.15, 0, m - 0.02, 0.21), MATERIALS.boot));
    g.add(new THREE.Mesh(box(0.12, 0.025, 0.16, 0, m - 0.02, 0.19), MATERIALS.bootDark));
    return g;
  },
};
const KIND = {
  torso: 'torso', head: 'head', pelvis: 'pelvis', thighL: 'thigh', thighR: 'thigh', shinL: 'shin', shinR: 'shin',
  upperArmL: 'upperArm', upperArmR: 'upperArm', forearmL: 'forearm', forearmR: 'forearm', skiL: 'ski', skiR: 'ski',
};

// ------------------------------------------------------------ posing math
const _d = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4();
const _front = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();

// orient group so +Y points a->b and +Z points as close to `hint` as possible
function orient(group, a, b, hint, nominal) {
  _d.subVectors(b, a);
  const l = _d.length() || 1e-6;
  _d.multiplyScalar(1 / l);
  _z.copy(hint).addScaledVector(_d, -hint.dot(_d));
  if (_z.lengthSq() < 1e-8) _z.set(_d.y, -_d.x, 0);
  _z.normalize();
  _x.crossVectors(_d, _z);
  _m.makeBasis(_x, _d, _z);
  group.quaternion.setFromRotationMatrix(_m);
  group.position.copy(a);
  group.scale.set(1, l / nominal, 1);
}

// A full set of segment groups; used by both the live skier and the ragdoll.
export class Body {
  constructor(parent) {
    this.root = new THREE.Group();
    this.segs = SEGMENTS.map(([name, , , L]) => {
      // in a leg group +X is the skier's right, so the outside of the left leg is -X
      const side = name.endsWith('L') ? -1 : 1;
      const g = BUILDERS[KIND[name]](L, side);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      this.root.add(g);
      return g;
    });
    this.poles = [0, 1].map(() => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 1, 5).translate(0, 0.5, 0), MATERIALS.pole));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 7).translate(0, 0.92, 0), MATERIALS.basket));
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.root.add(g);
      return g;
    });
    parent.add(this.root);
  }

  // P: joint positions (local or world). skiRoll: extra roll of the skis about their long axis.
  apply(P, skiRoll = 0, polesTo = null) {
    // body "front": from the hips and spine (x = left, y = up -> z = front)
    _s.subVectors(P[J.lHip], P[J.rHip]);
    _u.subVectors(P[J.chest], P[J.hip]);
    _front.crossVectors(_s, _u).normalize();
    SEGMENTS.forEach(([name, a, b, L], i) => {
      const A = P[J[a]], B = P[J[b]];
      let hint = _front;
      if (name === 'skiL' || name === 'skiR') {
        // ski top faces up the shin; edge angle rolls it about its length
        const foot = P[J[name === 'skiL' ? 'lFoot' : 'rFoot']], knee = P[J[name === 'skiL' ? 'lKnee' : 'rKnee']];
        hint = _t.subVectors(knee, foot);
        if (skiRoll) { _d.subVectors(B, A).normalize(); hint.applyAxisAngle(_d, skiRoll); }
      }
      orient(this.segs[i], A, B, hint, L);
    });
    // poles: from the glove toward a tip point
    [J.lHand, J.rHand].forEach((h, i) => {
      const tip = polesTo ? polesTo[i] : _t.copy(P[h]).add(_d.set(0, -1, 0));
      orient(this.poles[i], P[h], tip, _front, 1.15);
      this.poles[i].scale.set(1, 1.15, 1);
    });
  }

  set visible(v) { this.root.visible = v; }
}

// ------------------------------------------------------------------ skier
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// two-bone IK: elbow/knee position given root, target, lengths, and a bend direction
function ik(out, root, target, l1, l2, bend) {
  _a.subVectors(target, root);
  let d = _a.length();
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  _a.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _b.copy(bend).addScaledVector(_a, -bend.dot(_a)).normalize();
  out.copy(root).addScaledVector(_a, along).addScaledVector(_b, h);
  // keep the end on the chain
  return out;
}

export class SkierModel {
  constructor(scene) {
    this.root = new THREE.Group();
    this.joints = JOINTS.map(() => new THREE.Vector3());
    this.body = new Body(this.root);
    this.poleTips = [new THREE.Vector3(), new THREE.Vector3()];
    scene.add(this.root);
    this.upSmooth = new THREE.Vector3(0, 1, 0);
    this.crouch = 0; this.leanS = 0; this.edgeS = 0; this.grabS = 0; this.pitchS = 0; this.absorb = 0; this.windS = 0;
    this._basis = new THREE.Matrix4();
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
  }

  update(sk, dt) {
    const k = 1 - Math.exp(-dt * 12);
    this.absorb = Math.max(0, this.absorb - dt * 2.5);
    const crouchTarget = Math.max(sk.charge / 0.5 * 0.8, sk.grind ? 0.35 : sk.grounded ? this.absorb : 0.3);
    this.crouch += (crouchTarget - this.crouch) * k;
    this.leanS += ((sk.grounded ? sk.lean : 0) - this.leanS) * k;
    this.edgeS += ((sk.grounded ? sk.edge : 0) - this.edgeS) * k;
    this.grabS += ((sk.grabbing ? 1 : 0) - this.grabS) * (1 - Math.exp(-dt * 18));
    // upper-body wind-up (counter-rotation before a spin)
    this.windS += ((sk.grounded ? -(sk.windSpin || 0) * 0.6 : 0) - this.windS) * k;
    const tuck = sk.tuck * (1 - this.grabS);

    this.pose(this.crouch, tuck, this.grabS, this.windS);
    this.body.apply(this.joints, -(this.edgeS - this.leanS), this.poleTips);

    if (sk.grounded || sk.grind) {
      const f = this._f.set(sk.heading.x, sk.heading.y, sk.heading.z);
      const u = this._u;
      this.upSmooth.lerp(_a.set(sk.n.x, sk.n.y, sk.n.z), 1 - Math.exp(-dt * (sk.grind ? 30 : 15))).normalize();
      u.copy(this.upSmooth);
      u.applyAxisAngle(_c.copy(f).normalize(), this.leanS);
      this.root.quaternion.setFromRotationMatrix(this.basisFrom(f, u));
    } else {
      // in the air the physics owns the full body orientation
      this.root.quaternion.set(sk.q.x, sk.q.y, sk.q.z, sk.q.w);
      this.upSmooth.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    }
    this.root.position.set(sk.pos.x, sk.pos.y, sk.pos.z);
  }

  // Right-handed basis with local z = forward, y = up, so local +x = skier's LEFT.
  basisFrom(fwd, up) {
    const z = _a.copy(fwd).normalize();
    const x = _b.crossVectors(up, z).normalize();
    const y = _c.crossVectors(z, x).normalize();
    return this._basis.makeBasis(x, y, z);
  }

  // Local-space pose. x>0 is the skier's LEFT, y up, z forward.
  pose(crouch, tuck, grab, wind) {
    const P = this.joints;
    const hipH = 0.88 - 0.28 * crouch - 0.3 * tuck - 0.14 * grab;
    const hipZ = -0.1 - 0.12 * tuck - 0.06 * crouch;
    const stance = 0.14; // a bit wider than hip width: athletic park stance
    P[J.lFoot].set(stance, 0.12, 0); P[J.rFoot].set(-stance, 0.12, 0);
    P[J.hip].set(0, hipH, hipZ);
    P[J.lHip].set(0.1, hipH, hipZ); P[J.rHip].set(-0.1, hipH, hipZ);
    const kneeFwd = _c.set(0, 0, 1);
    ik(P[J.lKnee], P[J.lHip], P[J.lFoot], 0.46, 0.46, kneeFwd.set(0.25, 0, 1));
    ik(P[J.rKnee], P[J.rHip], P[J.rFoot], 0.46, 0.46, kneeFwd.set(-0.25, 0, 1));
    // re-seat feet exactly at the end of the shin (IK clamps reach)
    for (const s of ['l', 'r']) {
      const hip = P[J[s + 'Hip']], knee = P[J[s + 'Knee']], foot = P[J[s + 'Foot']];
      if (hip.distanceTo(foot) > 0.919) foot.copy(knee).add(_a.subVectors(foot, knee).setLength(0.46));
    }

    const tilt = 0.22 + 0.95 * tuck + 0.35 * crouch + 0.35 * grab;
    const chest = P[J.chest].set(0, hipH + 0.52 * Math.cos(tilt), hipZ + 0.52 * Math.sin(tilt));
    P[J.head].set(0, chest.y + 0.2 * Math.cos(tilt * 0.55), chest.z + 0.2 * Math.sin(tilt * 0.55));
    // shoulders, twisted by the wind-up
    const cw = Math.cos(wind), sw = Math.sin(wind);
    P[J.lShoulder].set(0.21 * cw, chest.y - 0.04, chest.z - 0.21 * sw);
    P[J.rShoulder].set(-0.21 * cw, chest.y - 0.04, chest.z + 0.21 * sw);

    // hands: relaxed forward-and-out, tuck pulls them in front of the face
    for (const [s, sx] of [['l', 1], ['r', -1]]) {
      const hand = P[J[s + 'Hand']];
      hand.set(sx * (0.34 - 0.2 * tuck), chest.y - 0.45 + 0.33 * tuck, chest.z + 0.3 + 0.08 * tuck);
      if (s === 'r' && grab > 0) hand.lerp(_a.set(-0.2, 0.22, 0.3), grab); // safety grab
      hand.x = hand.x * cw - hand.z * sw * sx * 0.3;
      ik(P[J[s + 'Elbow']], P[J[s + 'Shoulder']], hand, 0.3, 0.28, _b.set(sx * 0.8, -0.3, -0.6));
      // place the hand exactly at the end of the forearm
      hand.copy(P[J[s + 'Elbow']]).add(_a.subVectors(hand, P[J[s + 'Elbow']]).setLength(0.28));
      // poles drag behind; in a tuck they tuck under the arms
      const tip = this.poleTips[s === 'l' ? 0 : 1];
      if (tuck > 0.5) tip.set(hand.x * 1.5, hand.y + 0.05, hand.z - 1.12);
      else tip.set(hand.x + sx * 0.08, 0.02, hand.z - 0.62);
    }
    // skis: binding at the boot, 0.75 m of tail behind, 0.97 m in front
    for (const s of ['l', 'r']) {
      const foot = P[J[s + 'Foot']];
      P[J[s + 'Tail']].set(foot.x, 0.0, -0.75);
      P[J[s + 'Tip']].set(foot.x, 0.0, 0.97);
    }
  }

  worldJoints(out) {
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.joints.length; i++) out[i] = this.joints[i].clone().applyMatrix4(this.root.matrixWorld);
    return out;
  }

  set visible(v) { this.root.visible = v; }
}
