// Tiny allocation-light vector helpers on plain {x,y,z} objects.
// Kept separate from Three.js so physics runs headless in Node for tests.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const set = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };
export const copy = (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const addScaled = (o, a, s) => { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; };
export const scale = (o, s) => { o.x *= s; o.y *= s; o.z *= s; return o; };
export const cross = (o, a, b) => {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  o.x = x; o.y = y; o.z = z; return o;
};
export const normalize = (o) => { const l = len(o) || 1; o.x /= l; o.y /= l; o.z /= l; return o; };
// remove component along unit n
export const projectPlane = (o, n) => addScaled(o, n, -dot(o, n));
// rotate vector o about unit axis k by angle a (Rodrigues)
export const rotateAxis = (o, k, a) => {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, o) * (1 - c);
  const x = o.x * c + (k.y * o.z - k.z * o.y) * s + k.x * d;
  const y = o.y * c + (k.z * o.x - k.x * o.z) * s + k.y * d;
  const z = o.z * c + (k.x * o.y - k.y * o.x) * s + k.z * d;
  o.x = x; o.y = y; o.z = z; return o;
};
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));

// ---- quaternions {x,y,z,w} (rotation from body frame to world frame)
export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
export const qmul = (o, a, b) => {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  o.x = x; o.y = y; o.z = z; o.w = w; return o;
};
export const qnorm = (q) => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; q.x /= l; q.y /= l; q.z /= l; q.w /= l; return q; };
export const qaxis = (o, ax, ay, az, angle) => {
  const s = Math.sin(angle / 2); o.x = ax * s; o.y = ay * s; o.z = az * s; o.w = Math.cos(angle / 2); return o;
};
// rotate vector v by q into out
export const qrot = (out, q, vx, vy, vz) => {
  const ix = q.w * vx + q.y * vz - q.z * vy, iy = q.w * vy + q.z * vx - q.x * vz;
  const iz = q.w * vz + q.x * vy - q.y * vx, iw = -q.x * vx - q.y * vy - q.z * vz;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
};
// quaternion from orthonormal basis columns (x, y, z)
export const qbasis = (o, X, Y, Z) => {
  const m00 = X.x, m01 = Y.x, m02 = Z.x, m10 = X.y, m11 = Y.y, m12 = Z.y, m20 = X.z, m21 = Y.z, m22 = Z.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); o.w = 0.25 / s; o.x = (m21 - m12) * s; o.y = (m02 - m20) * s; o.z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); o.w = (m21 - m12) / s; o.x = 0.25 * s; o.y = (m01 + m10) / s; o.z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); o.w = (m02 - m20) / s; o.x = (m01 + m10) / s; o.y = 0.25 * s; o.z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); o.w = (m10 - m01) / s; o.x = (m02 + m20) / s; o.y = (m12 + m21) / s; o.z = 0.25 * s; }
  return qnorm(o);
};
// rotate q toward t by at most maxAngle (shortest path)
export const qtoward = (q, t, maxAngle) => {
  let d = q.x * t.x + q.y * t.y + q.z * t.z + q.w * t.w;
  let tx = t.x, ty = t.y, tz = t.z, tw = t.w;
  if (d < 0) { d = -d; tx = -tx; ty = -ty; tz = -tz; tw = -tw; }
  const ang = 2 * Math.acos(Math.min(1, d));
  if (ang < 1e-5) return q;
  const f = Math.min(1, maxAngle / ang);
  const th = Math.acos(Math.min(1, d)), s = Math.sin(th);
  let a = 1 - f, b = f;
  if (s > 1e-5) { a = Math.sin((1 - f) * th) / s; b = Math.sin(f * th) / s; }
  q.x = q.x * a + tx * b; q.y = q.y * a + ty * b; q.z = q.z * a + tz * b; q.w = q.w * a + tw * b;
  return qnorm(q);
};
