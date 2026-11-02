// Verlet-particle ragdoll for crashes. Joints from the skier model become
// particles, bones become distance constraints, and the snow is a collision
// surface with friction, so a crash tumbles with the momentum you had.
import * as THREE from 'three';
import { SEGMENTS, LINKS, J, Body } from './skierModel.js';

const EXTRA = [ // braces that keep the body from folding into a pile of noodles
  ['head', 'hip'], ['lHip', 'rHip'], ['chest', 'lHip'], ['chest', 'rHip'],
  ['lKnee', 'lTip'], ['lKnee', 'lTail'], ['rKnee', 'rTip'], ['rKnee', 'rTail'],
  ['lFoot', 'lTip'], ['lFoot', 'lTail'], ['rFoot', 'rTip'], ['rFoot', 'rTail'],
  ['hip', 'lHip'], ['hip', 'rHip'], ['head', 'lShoulder'], ['head', 'rShoulder'],
];

export class Ragdoll {
  constructor(scene, terrain, settings) {
    this.terrain = terrain; this.S = settings;
    this.group = new THREE.Group();
    this.body = new Body(this.group);
    this.group.visible = false;
    scene.add(this.group);
    this.p = []; this.prev = [];
    this.links = [...SEGMENTS.map(([, a, b]) => [J[a], J[b]]), ...LINKS.map(([a, b]) => [J[a], J[b]]), ...EXTRA.map(([a, b]) => [J[a], J[b]])];
    this.rest = [];
    this.active = false;
    this.time = 0; this.still = 0;
    this._n = { x: 0, y: 1, z: 0 };
  }

  start(joints, vel, spinAxis, spinRate, dt) {
    this.p = joints.map((j) => j.clone());
    this.rest = this.links.map(([a, b]) => this.p[a].distanceTo(this.p[b]));
    const com = new THREE.Vector3();
    this.p.forEach((q) => com.add(q)); com.multiplyScalar(1 / this.p.length);
    const w = spinAxis.clone().normalize().multiplyScalar(spinRate);
    const tmp = new THREE.Vector3();
    this.prev = this.p.map((q) => {
      // previous position = current - (linear + angular velocity) * dt
      tmp.subVectors(q, com).cross(w).negate().add(vel); // w × r
      return q.clone().addScaledVector(tmp, -dt);
    });
    this.active = true; this.time = 0; this.still = 0;
    this.group.visible = true;
  }

  stop() { this.active = false; this.group.visible = false; }

  step(dt) {
    if (!this.active) return;
    const g = this.S.gravity, T = this.terrain, n = this._n;
    this.time += dt;
    let maxV = 0;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i], o = this.prev[i];
      const vx = (q.x - o.x) * 0.999, vy = (q.y - o.y) * 0.999, vz = (q.z - o.z) * 0.999;
      o.copy(q);
      q.x += vx; q.y += vy - g * dt * dt; q.z += vz;
      maxV = Math.max(maxV, Math.hypot(vx, vy, vz) / dt);
    }
    for (let it = 0; it < 5; it++) {
      for (let k = 0; k < this.links.length; k++) {
        const [a, b] = this.links[k];
        const A = this.p[a], B = this.p[b];
        const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const corr = (d - this.rest[k]) / d * 0.5;
        A.x += dx * corr; A.y += dy * corr; A.z += dz * corr;
        B.x -= dx * corr; B.y -= dy * corr; B.z -= dz * corr;
      }
      // snow collision with friction
      for (let i = 0; i < this.p.length; i++) {
        const q = this.p[i], o = this.prev[i];
        const gy = T.height(q.x, q.z) + 0.06;
        if (q.y < gy) {
          T.normal(q.x, q.z, n);
          const pen = (gy - q.y) * n.y;
          q.x += n.x * pen; q.y += n.y * pen; q.z += n.z * pen;
          // friction: shrink tangential motion this step
          const mx = q.x - o.x, my = q.y - o.y, mz = q.z - o.z;
          const mn = mx * n.x + my * n.y + mz * n.z;
          const tx = mx - n.x * mn, ty = my - n.y * mn, tz = mz - n.z * mn;
          const f = 0.12;
          o.x += tx * f; o.y += ty * f; o.z += tz * f;
          if (mn < 0) { o.x += n.x * mn * 1.3; o.y += n.y * mn * 1.3; o.z += n.z * mn * 1.3; } // small bounce
        }
      }
    }
    for (const t of T.trees) {
      for (const q of this.p) {
        const dx = q.x - t.x, dz = q.z - t.z;
        if (Math.abs(dx) > 1 || Math.abs(dz) > 1) continue;
        const d = Math.hypot(dx, dz), rr = t.r + 0.1;
        if (d < rr) { q.x = t.x + dx / d * rr; q.z = t.z + dz / d * rr; }
      }
    }
    this.still = maxV < 0.8 ? this.still + dt : 0;
  }

  get settled() { return this.still > 0.6 || this.time > 4.5; }
  get center() { return this.p[J.chest]; }

  render() {
    if (!this.active) return;
    this.body.apply(this.p);
  }
}
