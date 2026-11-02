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
