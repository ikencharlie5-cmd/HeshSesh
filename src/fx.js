// Cheap visual feedback: snow spray (reads skid vs carve instantly),
// a blob shadow (essential for judging height in the air), and ski tracks.
import * as THREE from 'three';

export class Spray {
  constructor(scene, max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // soft round flakes (a square point sprite looks like confetti up close)
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.07, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1e5;
  }

  emit(x, y, z, vx, vy, vz, spread) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = vy + Math.random() * spread;
    this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
    this.life[i] = 0.5 + Math.random() * 0.5;
  }

  update(dt, gravity) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -1e5; continue; }
      this.vel[i * 3 + 1] -= gravity * 0.6 * dt;
      const drag = Math.exp(-dt * 2.5);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export function makeShadow(scene) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(20,30,50,0.55)'); grd.addColorStop(1, 'rgba(20,30,50,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

// Ski tracks: a ring buffer of thin quads laid on the snow.
export class Tracks {
  constructor(scene, maxSeg = 1500) {
    this.max = maxSeg;
    this.pos = new Float32Array(maxSeg * 6 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      color: 0x9fb4cc, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.i = 0;
    this.last = [null, null];
  }

  clear() {
    this.pos.fill(0); this.last = [null, null];
    const attr = this.geo.attributes.position; attr.clearUpdateRanges(); attr.needsUpdate = true;
  }

  // add a segment for ski k from its last point to p (THREE.Vector3), width w across direction
  add(k, p, w) {
    const last = this.last[k];
    if (!last) { this.last[k] = p.clone(); return; }
    const dx = p.x - last.x, dz = p.z - last.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) return;
    if (d > 3) { this.last[k] = p.clone(); return; }
    const nx = -dz / d * w, nz = dx / d * w;
    const o = this.i * 18; this.i = (this.i + 1) % this.max;
    const P = this.pos, y0 = last.y + 0.03, y1 = p.y + 0.03;
    const v = [last.x - nx, y0, last.z - nz, last.x + nx, y0, last.z + nz, p.x + nx, y1, p.z + nz,
      last.x - nx, y0, last.z - nz, p.x + nx, y1, p.z + nz, p.x - nx, y1, p.z - nz];
    for (let j = 0; j < 18; j++) P[o + j] = v[j];
    this.last[k].copy(p);
    const attr = this.geo.attributes.position;
    attr.addUpdateRange(o, 18); // upload only the new quad (three clears ranges after upload)
    attr.needsUpdate = true;
  }

  lift() { this.last = [null, null]; }
}
