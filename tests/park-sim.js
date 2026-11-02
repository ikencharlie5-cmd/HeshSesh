// Headless checks on the terrain park: rails (with a balancing bot), tables, halfpipe.
// Usage: node tests/park-sim.js
import { createPark } from '../src/park.js';
import { Skier } from '../src/skier.js';
import { defaultSettings } from '../src/settings.js';

const DT = 1 / 120;
const T = createPark();
const none = { left: false, right: false, up: false, down: false, jump: false, grab: false };

function ride(name, x, s, controller, maxT = 20, setup = () => {}) {
  const sk = new Skier(T, defaultSettings());
  sk.reset({ x, y: 0, z: -s }, { x: 0, y: 0, z: -1 });
  setup(sk);
  const log = [];
  let t = 0;
  while (t < maxT && !sk.crashed) {
    sk.step(DT, controller(sk, t));
    t += DT;
    for (const e of sk.events.splice(0)) {
      if (e.type === 'land' && e.airTime > 0.3) log.push(`  s=${(-sk.pos.z).toFixed(0)} x=${sk.pos.x.toFixed(1)} land air ${e.airTime.toFixed(2)}s h=${e.height.toFixed(1)} impact ${e.impact.toFixed(1)} tilt ${(e.tilt * 57.3).toFixed(0)}°`);
      if (e.type === 'grindStart') log.push(`  s=${(-sk.pos.z).toFixed(0)} on ${e.rail} at ${(sk.speed() * 3.6).toFixed(0)} km/h`);
      if (e.type === 'grind') log.push(`  s=${(-sk.pos.z).toFixed(0)} off ${e.rail}: ${e.time.toFixed(2)}s ${e.dist.toFixed(1)}m stance ${(e.stance * 57.3).toFixed(0)}°${e.fell ? ' (fell off)' : ''}`);
      if (e.type === 'crash') log.push(`  CRASH ${e.reason}`);
    }
  }
  console.log(`\n== ${name}\n${log.join('\n') || '  (nothing happened)'}`);
  return sk;
}

// aim at x on the snow; on a rail, counter-steer the lean
const aim = (lx) => (sk) => {
  if (sk.grind) return { ...none, left: sk.grind.phi > 0.03, right: sk.grind.phi < -0.03 };
  const tx = lx - sk.pos.x, tz = -15;
  const cross = sk.heading.x * tz - sk.heading.z * tx;
  const turn = Math.abs(cross) > 0.05 * Math.hypot(tx, tz);
  return { ...none, left: sk.grounded && turn && cross < 0, right: sk.grounded && turn && cross > 0 };
};
const noHands = (lx) => (sk) => (sk.grind ? none : aim(lx)(sk));

ride('Flat box, balancing', -10, 58, aim(-10));
ride('Flat box, hands off (should slide off sometimes)', -10, 58, noHands(-10));
ride('Flat-down rail, balancing', 10, 58, aim(10));
ride('Down rail, balancing', 0, 110, aim(0));
ride('Kinked rail, balancing', -12, 150, aim(-12));
ride('Tables S/M/L straight', 0, 205, aim(0), 30);
ride('Down rail, hands off', 0, 110, noHands(0));

// cork: hold → + ↑ together off the big table, then let go and let it settle
import { nameLanding } from '../src/tricks.js';
for (const hold of [0.7, 0.9, 1.1]) {
  const sk = new Skier(T, defaultSettings());
  sk.reset({ x: 0, y: 0, z: -380 }, { x: 0, y: 0, z: -1 });
  sk.vel.z = -14; sk.vel.y = -14 * Math.tan(14 * Math.PI / 180);
  let t = 0, done = false;
  while (t < 12 && !sk.crashed && !done) {
    const inAir = !sk.grounded && !sk.grind && -sk.pos.z > 418;
    sk.step(DT, { ...none, right: inAir && sk.airTime < hold, up: inAir && sk.airTime < hold });
    t += DT;
    for (const e of sk.events.splice(0)) {
      if (e.type === 'land' && e.airTime > 1) { console.log(`cork hold ${hold}s: ${nameLanding(e)} | air ${e.airTime.toFixed(2)}s tilt ${(e.tilt * 57.3).toFixed(0)}° impact ${e.impact.toFixed(1)}`); done = true; }
      if (e.type === 'crash') { console.log(`cork hold ${hold}s: CRASH ${e.reason}`); done = true; }
    }
  }
}
