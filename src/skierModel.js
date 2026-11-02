// Low-poly skier, posed procedurally from physics state each frame.
// Joints are computed in a local frame (x right, y up, z forward) and boxes
// are stretched between them, so the same joint list feeds the ragdoll.
import * as THREE from 'three';

const JOINTS = ['head', 'chest', 'hip', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lFoot', 'rFoot',
  'lElbow', 'rElbow', 'lHand', 'rHand', 'lTip', 'rTip', 'lTail', 'rTail'];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));

// bones drawn as boxes: [a, b, thickness, color]
export const BONES = [
  ['chest', 'head', 0.16, 'skin'],
  ['hip', 'chest', 0.3, 'jacket'],
  ['lHip', 'lKnee', 0.15, 'pants'], ['lKnee', 'lFoot', 0.13, 'pants'],
  ['rHip', 'rKnee', 0.15, 'pants'], ['rKnee', 'rFoot', 0.13, 'pants'],
  ['chest', 'lElbow', 0.1, 'jacket'], ['lElbow', 'lHand', 0.09, 'jacket'],
  ['chest', 'rElbow', 0.1, 'jacket'], ['rElbow', 'rHand', 0.09, 'jacket'],
  ['lTail', 'lTip', 0.035, 'ski'], ['rTail', 'rTip', 0.035, 'ski'],
];

export const MATERIALS = {
  skin: new THREE.MeshLambertMaterial({ color: 0xf0c8a0, flatShading: true }),
  jacket: new THREE.MeshLambertMaterial({ color: 0xe8462a, flatShading: true }),
  pants: new THREE.MeshLambertMaterial({ color: 0x23324a, flatShading: true }),
  ski: new THREE.MeshLambertMaterial({ color: 0x1a8cff, flatShading: true }),
  pole: new THREE.MeshLambertMaterial({ color: 0x222222 }),
  helmet: new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true }),
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.translate(0, 0.5, 0);
const HELMET = new THREE.IcosahedronGeometry(0.15, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Stretch a unit box from a to b. Skis are flat & wide, so they get a width axis.
export function placeBone(mesh, a, b, thick, wide = false) {
  _d.subVectors(b, a);
  const l = _d.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / (l || 1)));
  if (wide) mesh.scale.set(0.1, l, thick); else mesh.scale.set(thick, l, thick);
}

export class SkierModel {
  constructor(scene) {
    this.root = new THREE.Group();
    this.joints = JOINTS.map(() => new THREE.Vector3());
    this.meshes = BONES.map(([, , , m]) => {
      const mesh = new THREE.Mesh(UNIT_BOX, MATERIALS[m]);
      this.root.add(mesh);
      return mesh;
    });
    this.helmet = new THREE.Mesh(HELMET, MATERIALS.helmet);
    this.root.add(this.helmet);
    this.poles = [0, 1].map(() => { const m = new THREE.Mesh(UNIT_BOX, MATERIALS.pole); this.root.add(m); return m; });
    scene.add(this.root);

    this.upSmooth = new THREE.Vector3(0, 1, 0);
    this.crouch = 0; this.leanS = 0; this.edgeS = 0; this.grabS = 0; this.pitchS = 0;
    this._basis = new THREE.Matrix4();
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
  }

  // compute pose in local space then orient root from skier state
  update(sk, dt) {
    const k = 1 - Math.exp(-dt * 12);
    // crouch: ollie wind-up, landing absorption (spring), slight tuck in the air
    this.absorb = Math.max(0, (this.absorb || 0) - dt * 2.5);
    const crouchTarget = Math.max(sk.charge / 0.5 * 0.8, sk.grounded ? this.absorb : 0.25);
    this.crouch += (crouchTarget - this.crouch) * k;
    this.leanS += ((sk.grounded ? sk.lean : 0) - this.leanS) * k;
    this.edgeS += ((sk.grounded ? sk.edge : 0) - this.edgeS) * k;
    this.grabS += ((sk.grabbing ? 1 : 0) - this.grabS) * (1 - Math.exp(-dt * 18));
    const tuck = sk.tuck * (1 - this.grabS);

    this.pose(this.crouch, tuck, this.grabS, this.edgeS - this.leanS);

    // orientation
    const f = this._f.set(sk.heading.x, sk.heading.y, sk.heading.z);
    const u = this._u;
    if (sk.grounded) {
      this.upSmooth.lerp(_a.set(sk.n.x, sk.n.y, sk.n.z), 1 - Math.exp(-dt * 15)).normalize();
      u.copy(this.upSmooth);
      // body leans into the turn (rotate up around forward)
      const lean = this.leanS;
      u.applyAxisAngle(f.clone().normalize(), lean);
      this.pitchS = 0;
    } else {
      // skis follow the trajectory, plus the flip on top
      f.y = 0; f.normalize();
      const vh = Math.hypot(sk.vel.x, sk.vel.z);
      const align = vh > 0.1 ? (f.x * sk.vel.x + f.z * sk.vel.z) / vh : 0;
      const trajPitch = Math.atan2(-sk.vel.y, vh) * align;
      this.pitchS += (trajPitch - this.pitchS) * k;
      const right = this._r.crossVectors(f, _up).normalize();
      u.set(0, 1, 0);
      const pitch = this.pitchS + sk.flip;
      f.applyAxisAngle(right, -pitch);
      u.applyAxisAngle(right, -pitch);
    }
    this.root.quaternion.setFromRotationMatrix(this.basisFrom(f, u));
    this.root.position.set(sk.pos.x, sk.pos.y, sk.pos.z);
  }

  // Right-handed basis with local z = forward, y = up, so local +x = skier's LEFT.
  basisFrom(fwd, up) {
    const z = _a.copy(fwd).normalize();
    const x = _b.crossVectors(up, z).normalize();
    const y = _d.crossVectors(z, x).normalize();
    return this._basis.makeBasis(x, y, z);
  }

  // Local-space pose. x>0 is the skier's LEFT (see basisFrom), y up, z forward.
  pose(crouch, tuck, grab, edge) {
    const P = this.joints;
    const hipH = 0.93 - 0.32 * crouch - 0.33 * tuck - 0.12 * grab;
    const hipZ = -0.08 - 0.12 * tuck - 0.06 * crouch;
    P[J.lFoot].set(0.12, 0.09, 0); P[J.rFoot].set(-0.12, 0.09, 0);
    P[J.hip].set(0, hipH, hipZ);
    P[J.lHip].set(0.1, hipH, hipZ); P[J.rHip].set(-0.1, hipH, hipZ);
    // two-bone IK, knees bend forward
    for (const s of ['l', 'r']) {
      const hip = P[J[s + 'Hip']], foot = P[J[s + 'Foot']], knee = P[J[s + 'Knee']];
      const L = 0.46;
      const dy = hip.y - foot.y, dz = hip.z - foot.z;
      const d = Math.min(2 * L - 1e-3, Math.hypot(dy, dz));
      const along = d / 2, out = Math.sqrt(Math.max(0, L * L - along * along));
      const uy = dy / d, uz = dz / d;
      knee.set(hip.x * 0.9 + foot.x * 0.1, foot.y + uy * along - uz * out, foot.z + uz * along + uy * out);
    }
    const tilt = 0.18 + 0.95 * tuck + 0.35 * crouch + 0.3 * grab;
    P[J.chest].set(0, hipH + 0.52 * Math.cos(tilt), hipZ + 0.52 * Math.sin(tilt));
    const c = P[J.chest];
    P[J.head].set(0, c.y + 0.2 * Math.cos(tilt * 0.6), c.z + 0.2 * Math.sin(tilt * 0.6));
    // arms
    const handStand = [0.3, c.y - 0.42, c.z + 0.32];
    const handTuck = [0.13, c.y - 0.12, c.z + 0.38];
    for (const [s, sx] of [['l', 1], ['r', -1]]) {
      const hand = P[J[s + 'Hand']];
      hand.set(
        sx * (handStand[0] + (handTuck[0] - handStand[0]) * tuck),
        handStand[1] + (handTuck[1] - handStand[1]) * tuck,
        handStand[2] + (handTuck[2] - handStand[2]) * tuck,
      );
      if (s === 'r' && grab > 0) {
        // safety grab: right hand to the right ski just ahead of the boot
        hand.lerp(_a.set(-0.16, 0.16, 0.25), grab);
      }
      const shoulder = _b.set(sx * 0.2, c.y - 0.02, c.z);
      P[J[s + 'Elbow']].set((shoulder.x + hand.x) / 2 + sx * 0.08, (shoulder.y + hand.y) / 2 - 0.04, (shoulder.z + hand.z) / 2 - 0.06);
    }
    // skis rolled by the edge angle: tip/tail along z
    for (const [s, sx] of [['l', 1], ['r', -1]]) {
      const foot = P[J[s + 'Foot']];
      P[J[s + 'Tip']].set(foot.x, 0.03, 0.95);
      P[J[s + 'Tail']].set(foot.x, 0.03, -0.75);
    }

    // draw
    BONES.forEach(([a, b, th], i) => {
      const isSki = a.endsWith('Tail');
      placeBone(this.meshes[i], P[J[a]], P[J[b]], th, isSki);
      if (isSki) this.meshes[i].rotateY(-edge); // edge: ski rotates about its long (local y) axis
    });
    this.helmet.position.copy(P[J.head]).add(_a.set(0, 0.06, 0));
    // poles from hand, angled back
    [J.lHand, J.rHand].forEach((h, i) => {
      const hand = P[h];
      const tip = _a.set(hand.x + (i ? -0.05 : 0.05), 0.0, hand.z - 0.55 - 0.4 * tuck);
      if (tuck > 0.5) tip.set(hand.x * 1.6, hand.y - 0.3, hand.z - 1.1);
      placeBone(this.poles[i], hand, tip, 0.025);
    });
  }

  // world positions of all joints (for spawning the ragdoll)
  worldJoints(out) {
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.joints.length; i++) out[i] = this.joints[i].clone().applyMatrix4(this.root.matrixWorld);
    return out;
  }

  set visible(v) { this.root.visible = v; }
}
