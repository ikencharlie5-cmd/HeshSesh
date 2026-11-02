// Headless physics checks: run scripted skiers down the test slope and print
// what happens. Usage: node tests/physics-sim.js
import { createSlopeTerrain } from '../src/terrain.js';
import { Skier } from '../src/skier.js';
import { defaultSettings } from '../src/settings.js';

const DT = 1 / 120;
const terrain = createSlopeTerrain();

function run(name, startS, controller, maxT = 90, settings = defaultSettings()) {
  const sk = new Skier(terrain, settings);
  sk.reset({ x: 0, y: 0, z: -startS }, { x: 0, y: 0, z: -1 });
  const log = [];
  let t = 0, nextMark = 0, maxSpeed = 0;
  while (t < maxT && !sk.crashed) {
    const inp = controller(sk, t);
    sk.step(DT, inp);
    t += DT;
    maxSpeed = Math.max(maxSpeed, sk.speed());
    for (const e of sk.events.splice(0)) {
      if (e.type === 'land' && e.airTime > 0.25)
        log.push(`  t=${t.toFixed(1)} s=${(-sk.pos.z).toFixed(0)} LAND air=${e.airTime.toFixed(2)}s spin=${(e.spin * 57.3).toFixed(0)}° flip=${(e.flip * 57.3).toFixed(0)}° h=${e.height.toFixed(1)}m impact=${e.impact.toFixed(1)}m/s tilt=${(e.tilt * 57.3).toFixed(0)}°${e.crashed ? ' CRASH' : ''}`);
      if (e.type === 'crash') log.push(`  t=${t.toFixed(1)} s=${(-sk.pos.z).toFixed(0)} CRASH: ${e.reason}`);
    }
    if (t >= nextMark) {
      log.push(`  t=${t.toFixed(0).padStart(3)} s=${(-sk.pos.z).toFixed(0).padStart(4)} x=${sk.pos.x.toFixed(1).padStart(6)} v=${(sk.speed() * 3.6).toFixed(0).padStart(4)}km/h slope=${(sk.slopeAngle() * 57.3).toFixed(0).padStart(3)}° ${sk.grounded ? (sk.skidding ? 'skid' : sk.carving ? 'carve' : 'glide') : 'AIR'}`);
      nextMark += 5;
    }
    if (sk.grounded && sk.speed() < 0.05 && t > 5) { log.push(`  stopped at s=${(-sk.pos.z).toFixed(0)} t=${t.toFixed(1)}`); break; }
  }
  console.log(`\n== ${name} (max ${(maxSpeed * 3.6).toFixed(0)} km/h)`);
  console.log(log.join('\n'));
  return sk;
}

const none = { left: false, right: false, up: false, down: false, jump: false, grab: false };
run('Straight run, standing', 10, () => none);
run('Straight run, tucked', 10, () => ({ ...none, up: true }));
run('From Mellow checkpoint, tucked', 262, () => ({ ...none, up: true }), 40);
run('From Mellow, standing', 262, () => none, 40);
run('From Mellow, tuck + pop at lip', 262, (sk) => ({ ...none, up: -sk.pos.z < 398, jump: -sk.pos.z > 398 && -sk.pos.z < 414.8 }), 40);
// carving turns vs skidding: alternate turns every 2.5s on the steep pitch
run('Steep pitch: linked carves (light edge)', 60, (sk, t) => ({ ...none, left: Math.floor(t / 1.3) % 2 === 0, right: Math.floor(t / 1.3) % 2 === 1 }), 14);
run('Steep pitch: braking skid', 60, (sk, t) => ({ ...none, down: t > 4 }), 14);
run('Moon gravity (1.6)', 262, () => ({ ...none, up: true }), 40, { ...defaultSettings(), gravity: 1.62 });

// realistic air control: wind up with Space + arrow on the approach, release at the lip
function windRun(name, release, keys, settings) {
  const sk = run(name, 262, (s) => {
    const z = -s.pos.z;
    const winding = z > 400 && z < release;
    return { ...none, jump: winding, ...(winding ? keys : {}) };
  }, 22, settings);
  return sk;
}
windRun('Wind-up right spin, release at lip', 414.8, { right: true });
windRun('Wind-up back flip, release at lip', 414.8, { up: true });
