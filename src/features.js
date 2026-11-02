// Snow features (kickers / tables / natural booters) as height offsets that
// sit on top of the terrain. The physics samples terrain + offsets, and each
// feature also gets its own fine mesh so lips and knuckles render crisply.

const DEG = Math.PI / 180;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// spec: { x, s, yaw (deg, 0 = straight down the fall line), H (lip height above the slope),
//         lip (deg, takeoff angle relative to the slope), table (m), land (deg, landing steepness
//         relative to the slope), W (top width), slope (deg, pitch of the hill under it),
//         tableDeg (deg, absolute downhill pitch of the table), name }
// Like a real tabletop, the table runs flatter than the hill, so the knuckle
// stands higher than the lip and the landing is long and steep.
export function makeKicker(spec) {
  const { x, s, yaw = 0, H, lip, table = 0, land = 30, W = 8, slope = 0, tableDeg = 3, name = 'Kicker' } = spec;
  const a = { x: Math.sin(yaw * DEG), z: -Math.cos(yaw * DEG) };  // along (downhill)
  const b = { x: -a.z, z: a.x };                                  // across
  const Lr = (2 * H) / Math.tan(lip * DEG);       // parabolic ramp: slope at the lip = tan(lip)
  const rise = table > 0 ? Math.max(0, Math.tan(slope * DEG) - Math.tan(tableDeg * DEG)) : 0;
  const Hk = H + table * rise;                     // knuckle height above the hill
  const Ll = (1.5 * Hk) / Math.tan(land * DEG);   // smoothstep landing: max slope = tan(land)
  const L = Lr + table + Ll;
  const halfW = W / 2;
  const reach = halfW + Hk + 1;
  const x0 = x, z0 = -s;
  const r = Math.hypot(L, reach) + 1;
  const cx = x0 + a.x * L / 2, cz = z0 + a.z * L / 2;

  function along(u) {
    if (u <= 0 || u >= L) return 0;
    if (u < Lr) { const t = u / Lr; return H * t * t; }
    if (u < Lr + table) return H + (u - Lr) * rise;
    return Hk * (1 - smooth((u - Lr - table) / Ll));
  }

  function offset(px, pz) {
    const dx = px - cx, dz = pz - cz;
    if (dx * dx + dz * dz > r * r) return 0;
    const qx = px - x0, qz = pz - z0;
    const u = qx * a.x + qz * a.z;
    const v = qx * b.x + qz * b.z;
    const o = along(u);
    if (o <= 0) return 0;
    const side = Math.abs(v) - halfW;
    return side <= 0 ? o : Math.max(0, o - side); // 45° side walls
  }

  // 0..1 "inside this feature" mask, used to calm terrain noise under it
  function mask(px, pz) {
    const dx = px - cx, dz = pz - cz;
    const d = Math.hypot(dx, dz);
    return d > r + 8 ? 0 : 1 - smooth((d - r) / 8);
  }

  return {
    name, kind: table > 0 ? 'table' : 'booter', H, Hk, lip, table, land, W,
    x0, z0, a, b, Lr, L, reach, cx, cz, r,
    offset, mask, along,
  };
}
