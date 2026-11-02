import * as THREE from 'three';
import { createSlopeTerrain } from './terrain.js';
import { createMountain } from './mountain.js';
import { buildWorld } from './world.js';
import { Skier } from './skier.js';
import { SkierModel } from './skierModel.js';
import { Ragdoll } from './ragdoll.js';
import { Spray, makeShadow, Tracks } from './fx.js';
import { scoreLanding } from './tricks.js';
import { SkiAudio } from './audio.js';
import { SETTINGS_SPEC, loadSettings, saveSettings, defaultSettings } from './settings.js';

const DT = 1 / 120;           // physics step
const SKY = 0xc4d8ec;      // horizon haze
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); // Chromebook-friendly
renderer.setSize(innerWidth, innerHeight);
// one small shadow map that follows the skier: cheap, and it grounds the character
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 250, 2200);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 5000);
// Three's Lambert divides by π, so these intensities sum to ~1 on flat snow.
scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x6f7f9f, 0.95));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
const SUN_DIR = new THREE.Vector3(-0.55, 1, 0.25).normalize(); // high, from the side
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 60 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// sky dome: vertex-colored gradient, follows the camera
const sky = (() => {
  const g = new THREE.SphereGeometry(4000, 24, 12);
  const col = [], top = new THREE.Color(0x3f78c0), mid = new THREE.Color(0x8fb8e6), hor = new THREE.Color(SKY);
  const p = g.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / 4000;
    if (h > 0.25) c.copy(mid).lerp(top, Math.min(1, (h - 0.25) / 0.6));
    else c.copy(hor).lerp(mid, Math.max(0, h / 0.25));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// --------------------------------------------------------------- settings
const settings = loadSettings();
function buildSettingsPanel() {
  const list = $('settings-list');
  list.innerHTML = '';
  for (const p of SETTINGS_SPEC) {
    const row = document.createElement('div');
    row.className = 'setting';
    row.innerHTML = `<label><span>${p.label}</span><span class="val"></span></label>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}">
      ${p.help ? `<div class="help">${p.help}</div>` : ''}`;
    const input = row.querySelector('input'), val = row.querySelector('.val');
    const show = () => { val.textContent = `${(+settings[p.key]).toFixed(p.step < 0.01 ? 3 : 2)} ${p.unit}`; };
    input.value = settings[p.key]; show();
    input.addEventListener('input', () => { settings[p.key] = +input.value; show(); saveSettings(settings); });
    // hand the arrow keys back to the game once you let go of the slider
    input.addEventListener('change', () => input.blur());
    input.addEventListener('pointerup', () => input.blur());
    list.appendChild(row);
  }
}
buildSettingsPanel();
$('btn-reset-settings').onclick = () => { Object.assign(settings, defaultSettings()); saveSettings(settings); buildSettingsPanel(); };
const toggleSettings = (show) => $('settings').classList.toggle('hidden', show === undefined ? undefined : !show);
$('btn-settings').onclick = (e) => { toggleSettings(); e.currentTarget.blur(); };
$('btn-close-settings').onclick = () => toggleSettings(false);
$('btn-menu-settings').onclick = () => toggleSettings(true);

// ------------------------------------------------------------------ world
const TERRAINS = { mountain: createMountain, slope: createSlopeTerrain };
const built = {};       // terrain + scene group per mode, built on first use
let terrain = null, worldGroup = null;
function useTerrain(mode) {
  if (!built[mode]) {
    const t = TERRAINS[mode]();
    built[mode] = { terrain: t, group: buildWorld(t) };
  }
  if (worldGroup) scene.remove(worldGroup);
  terrain = built[mode].terrain;
  worldGroup = built[mode].group;
  scene.add(worldGroup);
  skier.terrain = terrain;
  ragdoll.terrain = terrain;
}

const skier = new Skier(createSlopeTerrain(), settings);
const model = new SkierModel(scene);
const ragdoll = new Ragdoll(scene, skier.terrain, settings);
const spray = new Spray(scene);
const shadow = makeShadow(scene);
const tracks = new Tracks(scene);
const audio = new SkiAudio();
useTerrain('mountain');

// ------------------------------------------------------------------ input
const keys = new Set();
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  audio.start();
  if (e.code === 'Escape') togglePause();
  if (!state.playing) return;
  if (e.code === 'KeyR' || (e.code === 'Space' && skier.crashed && state.crashTime > 0.4)) respawn(state.cp);
  if (e.code.startsWith('Digit')) { const i = +e.code.slice(5) - 1; if (i >= 0 && i < terrain.checkpoints.length) { state.cp = i; respawn(i); } }
  if (e.code === 'KeyT') { state.cp = 0; respawn(0); } // back to the top
  if (e.code === 'KeyP') toggleSettings();
  if (e.code === 'KeyM') audio.muted = !audio.muted;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  return {
    left: k('ArrowLeft', 'KeyA'), right: k('ArrowRight', 'KeyD'),
    up: k('ArrowUp', 'KeyW'), down: k('ArrowDown', 'KeyS'),
    jump: k('Space'), grab: k('ShiftLeft', 'ShiftRight', 'KeyG'),
  };
}

// ------------------------------------------------------------------ state
const state = { playing: false, paused: false, cp: 0, score: 0, crashTime: 0, trickTimer: 0 };

function respawn(i) {
  const cp = terrain.checkpoints[i];
  skier.reset({ x: cp.x, y: 0, z: cp.z }, { x: 0, y: 0, z: -1 });
  ragdoll.stop();
  model.visible = true;
  tracks.lift();
  $('crash').classList.add('hidden');
  $('checkpoint').textContent = `Checkpoint: ${cp.label}`;
  snapCamera();
}

function startMode(mode) {
  if (!TERRAINS[mode]) return;
  useTerrain(mode);
  state.playing = true; state.paused = false; state.cp = 0; state.score = 0;
  $('score').textContent = '0';
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('btn-resume').classList.remove('hidden');
  tracks.clear();
  respawn(0);
}
document.querySelectorAll('.mode[data-mode]').forEach((b) => (b.onclick = () => { audio.start(); startMode(b.dataset.mode); b.blur(); }));
$('btn-resume').onclick = () => togglePause(false);

function togglePause(force) {
  if (!state.playing) return;
  state.paused = force === undefined ? !state.paused : force;
  $('menu').classList.toggle('hidden', !state.paused);
}

// ------------------------------------------------------------------ events
function handleEvents() {
  for (const e of skier.events.splice(0)) {
    if (e.type === 'land') {
      model.absorb = Math.min(0.9, 0.15 + e.impact / 9);
      if (e.airTime > 0.15) { $('t-air').textContent = `${e.airTime.toFixed(2)}s · ${e.height.toFixed(1)}m`; burst(Math.min(60, 10 + e.impact * 6)); }
      if (!e.crashed) {
        const t = scoreLanding(e);
        if (t) showTrick(t);
      }
    } else if (e.type === 'crash') {
      onCrash(e.reason);
    }
  }
}

function showTrick(t) {
  state.score += t.score;
  $('score').textContent = state.score.toLocaleString();
  $('trick-name').textContent = t.name;
  $('trick-grade').textContent = t.grade;
  $('trick-grade').classList.toggle('sketchy', t.grade === 'Sketchy');
  $('trick-score').textContent = `+${t.score}`;
  const el = $('trick');
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  state.trickTimer = 2.0;
}

function onCrash(reason) {
  state.crashTime = 0;
  $('crash-reason').textContent = reason;
  $('crash').classList.remove('hidden');
  const joints = model.worldJoints([]);
  const vel = new THREE.Vector3(skier.vel.x, skier.vel.y, skier.vel.z);
  const speed = vel.length();
  // tumble forward around the axis perpendicular to travel, plus some random twist
  const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), vel.lengthSq() > 0.01 ? vel : new THREE.Vector3(0, 0, -1)).normalize();
  axis.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8));
  ragdoll.start(joints, vel, axis, 2 + speed * 0.25, DT);
  model.visible = false;
  burst(50);
}

const _right = new THREE.Vector3(), _p = new THREE.Vector3();
function burst(n) {
  for (let i = 0; i < n; i++) spray.emit(skier.pos.x, skier.pos.y + 0.1, skier.pos.z, skier.vel.x * 0.3, 1.5, skier.vel.z * 0.3, 4);
}

function fxStep(dt) {
  const sk = skier;
  if (sk.crashed || !sk.grounded) { tracks.lift(); return; }
  const n = sk.n, h = sk.heading;
  _right.set(h.y * n.z - h.z * n.y, h.z * n.x - h.x * n.z, h.x * n.y - h.y * n.x).normalize();
  for (let k = 0; k < 2; k++) {
    _p.set(sk.pos.x, sk.pos.y, sk.pos.z).addScaledVector(_right, k ? 0.13 : -0.13);
    tracks.add(k, _p, sk.skidding ? 0.25 : 0.05);
  }
  // spray: proportional to the energy the skid is dissipating
  const s = sk.speed();
  const count = sk.skidding ? Math.min(8, sk.scrubPower / 3000) : (sk.carving && s > 12 ? 0.3 : 0);
  for (let i = 0; i < count || (i === 0 && Math.random() < count); i++) {
    const side = Math.sign(sk.edge) || 1;
    spray.emit(sk.pos.x - _right.x * side * 0.3, sk.pos.y + 0.05, sk.pos.z - _right.z * side * 0.3,
      sk.vel.x * 0.55 - _right.x * side * 2, 1.2 + Math.random() * 1.5, sk.vel.z * 0.55 - _right.z * side * 2, 2.2);
  }
}

// ------------------------------------------------------------------ camera
const camDir = new THREE.Vector3(0, 0, -1);
const camTarget = new THREE.Vector3();
function focusPoint() {
  return skier.crashed && ragdoll.active ? ragdoll.center : _p.set(skier.pos.x, skier.pos.y, skier.pos.z);
}
function snapCamera() {
  camDir.set(0, 0, -1);
  const f = focusPoint();
  camera.position.set(f.x, f.y + 3, f.z + 7);
  camTarget.set(f.x, f.y + 1, f.z - 4);
  camera.lookAt(camTarget);
}
function updateCamera(dt) {
  const sk = skier;
  const speed = sk.speed();
  if (!sk.crashed) {
    const vh = Math.hypot(sk.vel.x, sk.vel.z);
    const d = vh > 2.5 ? _right.set(sk.vel.x / vh, 0, sk.vel.z / vh) : _right.set(sk.heading.x, 0, sk.heading.z).normalize();
    camDir.lerp(d, 1 - Math.exp(-dt * (sk.grounded ? 2.5 : 1.2))).normalize();
  }
  const f = focusPoint().clone();
  const dist = 6.5 + Math.min(speed, 35) * 0.07;
  const desired = f.clone().addScaledVector(camDir, -dist);
  desired.y += 2.6 + Math.min(speed, 35) * 0.02;
  const ground = terrain.height(desired.x, desired.z) + 1.4;
  if (desired.y < ground) desired.y = ground;
  camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
  camTarget.lerp(f.addScaledVector(camDir, 4).add(_p.set(0, 0.9, 0)), 1 - Math.exp(-dt * 10));
  camera.lookAt(camTarget);
  const fov = 62 + Math.min(speed, 40) * 0.35;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ HUD
const hud = {
  kmh: $('speed-kmh'), ms: $('speed-ms'), slope: $('t-slope'), edge: $('t-edge'), slip: $('t-slip'), g: $('t-g'), st: $('t-state'),
};
let hudTimer = 0;
function updateHud(dt) {
  hudTimer -= dt;
  if (state.trickTimer > 0) { state.trickTimer -= dt; if (state.trickTimer <= 0) $('trick').classList.add('hidden'); }
  if (hudTimer > 0) return; // DOM writes at ~20 Hz are plenty
  hudTimer = 0.05;
  const sk = skier, s = sk.speed();
  hud.kmh.textContent = Math.round(s * 3.6);
  hud.ms.textContent = `${s.toFixed(1)} m/s`;
  hud.slope.textContent = `${Math.round(sk.slopeAngle() * 57.3)}°`;
  hud.edge.textContent = `${Math.round(Math.abs(sk.edge) * 57.3)}°`;
  hud.slip.textContent = `${Math.round(sk.slip * 57.3)}°`;
  hud.g.textContent = `${(sk.grounded ? sk.Nacc / settings.gravity : 0).toFixed(1)} g`;
  let label = 'GLIDE', cls = '';
  if (sk.crashed) label = 'CRASH';
  else if (!sk.grounded) { label = 'AIR'; cls = 'air'; }
  else if (sk.skidding) { label = 'SKID'; cls = 'skid'; }
  else if (sk.carving) { label = 'CARVE'; cls = 'carve'; }
  else if (sk.tuck > 0.5) { label = 'TUCK'; cls = 'tuck'; }
  if (sk.switch && !sk.crashed) label += ' (switch)';
  hud.st.textContent = label;
  hud.st.className = `state ${cls}`;
}

// ------------------------------------------------------------------ loop
const debug = { freeCam: false };
let acc = 0, last = performance.now();
snapCamera();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.playing && !state.paused) {
    const simDt = dt * settings.simSpeed;
    acc += simDt;
    const input = readInput();
    let steps = 0;
    while (acc >= DT && steps < 10) {
      skier.step(DT, input);
      ragdoll.step(DT);
      handleEvents();
      acc -= DT; steps++;
    }
    if (steps === 10) acc = 0;
    if (skier.crashed) {
      state.crashTime += simDt;
      if (ragdoll.settled && state.crashTime > 1.2) respawn(state.cp);
    } else {
      // ride through a checkpoint's flags to make it your respawn point
      const cps = terrain.checkpoints;
      for (let i = 0; i < cps.length; i++) {
        if (i !== state.cp && skier.grounded && Math.hypot(skier.pos.x - cps[i].x, skier.pos.z - cps[i].z) < 12) {
          state.cp = i; $('checkpoint').textContent = `Checkpoint: ${cps[i].label}`;
        }
      }
    }
    model.update(skier, simDt);
    ragdoll.render();
    fxStep(simDt);
    spray.update(simDt, settings.gravity);
    // blob shadow on the snow under the skier (shrinks/fades with height)
    const f = focusPoint();
    const gy = terrain.height(f.x, f.z);
    const hgt = Math.max(0, f.y - gy);
    const nn = terrain.normal(f.x, f.z, { x: 0, y: 1, z: 0 });
    shadow.position.set(f.x, gy + 0.04, f.z);
    shadow.lookAt(f.x + nn.x, gy + 0.04 + nn.y, f.z + nn.z);
    const sc = 1.6 / (1 + hgt * 0.15);
    shadow.scale.set(sc, sc * 1.5, 1);
    shadow.visible = !skier.crashed;
    shadow.material.opacity = Math.max(0, 0.6 - hgt * 0.04); // blob mainly helps judge height in the air
    sun.target.position.set(f.x, f.y, f.z);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 30);
    if (!debug.freeCam) updateCamera(dt);
    updateHud(dt);
    audio.update(skier.speed(), skier.crashed ? 0 : skier.scrubPower, !skier.grounded);
  } else if (!debug.freeCam) {
    audio.update(0, 0, true);
    // idle flyby behind the menu
    const t = now / 1000, c0 = terrain.checkpoints[0];
    const y0 = terrain.height(c0.x, c0.z);
    camera.position.set(c0.x + Math.sin(t * 0.05) * 60, y0 + 45, c0.z + 60 + Math.cos(t * 0.05) * 30);
    camera.lookAt(c0.x, y0 - 120, c0.z - 400);
  }
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// expose for debugging in the console
window.heshsesh = { skier, settings, get terrain() { return terrain; }, state, camera, debug };
