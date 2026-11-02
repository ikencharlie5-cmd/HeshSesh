// Headless checks on the freeride mountain: ride the jump line and a few runs.
// Usage: node tests/mountain-sim.js
import { createMountain } from '../src/mountain.js';
import { Skier } from '../src/skier.js';
import { defaultSettings } from '../src/settings.js';

const DT = 1 / 120;
const T = createMountain();
const none = { left: false, right: false, up: false, down: false, jump: false, grab: false };

function ride(name, x, s, controller, maxT = 40) {
  const sk = new Skier(T, defaultSettings());
  sk.reset({ x, y: 0, z: -s }, { x: 0, y: 0, z: -1 });
  const log = [];
  let t = 0, mark = 0, vmax = 0;
  while (t < maxT && !sk.crashed) {
    sk.step(DT, controller(sk, t));
    t += DT; vmax = Math.max(vmax, sk.speed());
    for (const e of sk.events.splice(0)) {
      if (e.type === 'land' && e.airTime > 0.35) log.push(`  s=${(-sk.pos.z).toFixed(0)} air ${e.airTime.toFixed(2)}s h=${e.height.toFixed(1)}m impact ${e.impact.toFixed(1)} spin ${(e.spin * 57.3).toFixed(0)} flip ${(e.flip * 57.3).toFixed(0)} tilt=${(e.tilt * 57.3).toFixed(0)}°${e.crashed ? ' CRASH' : ''}`);
      if (e.type === 'crash') log.push(`  s=${(-sk.pos.z).toFixed(0)} x=${sk.pos.x.toFixed(0)} CRASH ${e.reason}`);
    }
    if (t >= mark) { log.push(`  t=${t.toFixed(0)} s=${(-sk.pos.z).toFixed(0)} x=${sk.pos.x.toFixed(0)} ${(sk.speed() * 3.6).toFixed(0)} km/h`); mark += 5; }
  }
  console.log(`\n== ${name} (max ${(vmax * 3.6).toFixed(0)} km/h)\n${log.join('\n')}`);
}

// steer gently back toward a target x line
// aim at a point 15 m ahead on the line; steer only on the snow
const holdLine = (lx, extra = () => ({})) => (sk, t) => {
  const tx = lx - sk.pos.x, tz = -15;
  const cross = sk.heading.x * tz - sk.heading.z * tx; // >0: target is to the left
  const turn = Math.abs(cross) > 0.05 * Math.hypot(tx, tz);
  return { ...none, left: sk.grounded && turn && cross < 0, right: sk.grounded && turn && cross > 0, ...extra(sk, t) };
};
ride('Jump line, straight, standing', -150, 955, holdLine(-150), 30);
ride('Jump line, speed-checking (skid above 55 km/h)', -150, 955, holdLine(-150, (sk) => ({ down: sk.grounded && sk.speed() > 15.3 && !nearLip(sk) })), 30);
ride('Jump line, back flip on every jump', -150, 955, holdLine(-150, (sk) => ({ up: !sk.grounded && -sk.pos.z > 1100 && sk.maxAirHeight > 0.5 && sk.flip > -4.6, down: sk.grounded && sk.speed() > 15.3 && !nearLip(sk) })), 30);
ride('Summit straight down main run', 0, 20, (sk) => { const s = -sk.pos.z; const lx = 60 * Math.sin(s / 220) + 20 * Math.sin(s / 90); const dx = lx - sk.pos.x; return { ...none, left: sk.grounded && dx < -3, right: sk.grounded && dx > 3 }; }, 90);

function nearLip(sk) {
  for (const f of T.features) {
    const u = (sk.pos.x - f.x0) * f.a.x + (sk.pos.z - f.z0) * f.a.z;
    if (u > -25 && u < f.Lr + 1 && Math.abs((sk.pos.x - f.x0) * f.b.x + (sk.pos.z - f.z0) * f.b.z) < f.W) return true;
  }
  return false;
}
