// Skier physics.
//
// The skier is a point mass (75 kg) with a ski heading and an edge angle.
// Everything that matters for feel is derived from forces, not scripted:
//
//  * Gravity is projected onto the local slope plane, so speed comes from
//    slope angle and you decelerate on flats and uphill.
//  * The ski is anisotropic: low Coulomb friction along it (glide μ), high
//    friction across it (skid μ). Sideways motion is "scrubbed" by that
//    friction, and the work it does is the speed you lose in a skid.
//  * Carving: an edged ski bends to an arc of radius ≈ sidecut / sin(edge).
//    Riding that arc rotates the velocity with the ski with no friction loss,
//    *as long as* the edge can supply the needed centripetal force
//    (v²/R ≤ grip · N). Ask for more and the ski washes out into a skid.
//  * Normal force comes from the ground constraint, so it includes terrain
//    curvature (compressions push you harder into the snow = more friction,
//    rollovers lighten you and can launch you).
//  * Airtime is plain ballistics after the ground falls away faster than
//    gravity can pull you down. Jump height is set by takeoff speed + lip.
//  * Landing impact = velocity component into the landing surface, so
//    matching the slope (landing on a downslope) is soft; flat is brutal.
//  * Air drag ½ρCdAv² with frontal area depending on stance/tuck.

import {
  v3, set, copy, dot, len, addScaled, scale, cross, normalize, projectPlane,
  rotateAxis, clamp, wrapPi, approach,
} from './vec.js';

const DEG = Math.PI / 180;
const MASS = 75;
const RHO = 1.2;
const MAX_EDGE = 65 * DEG;

export class Skier {
  constructor(terrain, settings) {
    this.terrain = terrain;
    this.S = settings;
    this.pos = v3(); this.vel = v3(); this.heading = v3(0, 0, -1);
    this.n = v3(0, 1, 0);
    this.events = [];
    this._f = v3(); this._r = v3(); this._t = v3(); this._tmp = v3(); this._g = v3();
    this.buildTreeGrid();
    this.reset(v3(0, 0, -10), v3(0, 0, -1));
  }

  buildTreeGrid() {
    this.treeGrid = new Map();
    for (const t of this.terrain.trees) {
      const k = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
      if (!this.treeGrid.has(k)) this.treeGrid.set(k, []);
      this.treeGrid.get(k).push(t);
    }
  }

  reset(pos, dir) {
    copy(this.pos, pos);
    this.pos.y = this.terrain.height(pos.x, pos.z);
    set(this.vel, 0, 0, 0);
    copy(this.heading, dir);
    this.terrain.normal(this.pos.x, this.pos.z, this.n);
    projectPlane(this.heading, this.n); normalize(this.heading);
    this.grounded = true;
    this.crashed = false;
    this.edge = 0;          // signed edge angle (rad), + = tipped toward travel-right
    this.tuck = 0;          // 0 stand .. 1 full tuck
    this.charge = 0;        // ollie crouch (s)
    this.windSpin = 0;      // pre-wound rotation while crouched for an ollie (-1..1)
    this.windFlip = 0;
    this.yawRate = 0;       // how fast the skis are turning on the snow (rad/s, + = right)
    this.spinMom = 0; this.flipMom = 0; // angular momentum per unit inertia, open body
    this.coyote = null;
    this.airArm = { left: true, right: true, up: true, down: true };
    this.jumpWasHeld = false;
    this.Nacc = this.S.gravity; // normal acceleration (m/s²) the snow pushes back with
    this.slip = 0;          // angle between ski and travel direction
    this.skidding = false;
    this.carving = false;
    this.lean = 0;          // visual body lean (rad)
    this.brakeSide = 1;
    this.switch = false;
    this.airTime = 0;
    this.spin = 0; this.flip = 0; this.spinRate = 0; this.flipRate = 0;
    this.grabbing = false; this.grabTime = 0;
    this.maxAirHeight = 0;
    this.lastImpact = 0;
    this.scrubPower = 0;    // W of energy being dissipated by skidding (for spray/sound)
  }

  speed() { return len(this.vel); }

  // ---------------------------------------------------------------------
  step(dt, input) {
    if (this.crashed) return;
    if (this.grounded) this.stepGround(dt, input);
    else this.stepAir(dt, input);
    this.collideTrees();
    // world bounds
    const T = this.terrain;
    if (this.pos.z < -(T.length - 2)) { this.pos.z = -(T.length - 2); if (this.vel.z < 0) this.vel.z = 0; }
    if (this.pos.z > 15) { this.pos.z = 15; if (this.vel.z > 0) this.vel.z = 0; }
    const hw = T.halfWidth - 1;
    if (Math.abs(this.pos.x) > hw) { this.pos.x = Math.sign(this.pos.x) * hw; this.vel.x = 0; }
  }

  // ---------------------------------------------------------------------
  stepGround(dt, inp) {
    const S = this.S, T = this.terrain;
    const g = S.gravity;
    const n = T.normal(this.pos.x, this.pos.z, this.n);
    const v = this.vel;

    // ski frame: f along ski, r to the ski's right
    const f = copy(this._f, this.heading); projectPlane(f, n);
    if (len(f) < 1e-4) { copy(f, v); projectPlane(f, n); }
    normalize(f); copy(this.heading, f);
    const r = cross(this._r, f, n);

    let speed = len(v);
    let vf = dot(v, f);
    const dirSign = vf >= 0 ? 1 : -1;     // riding forward or switch
    if (speed > 1.5) this.switch = dirSign < 0;
    const charging = inp.jump;
    const headingBefore = copy(this._hb || (this._hb = v3()), f);
    // While crouched for an ollie the arrows wind the upper body up instead of
    // steering: skis run flat and straight, rotation gets stored for the pop.
    const steerRaw = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const flipRaw = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (charging) {
      // ~1.2 s to wind up fully: hold longer = more rotation
      this.windSpin = approach(this.windSpin, steerRaw ? steerRaw : this.windSpin, 0.85 * dt);
      this.windFlip = approach(this.windFlip, flipRaw ? flipRaw : this.windFlip, 0.85 * dt);
    } else {
      this.windSpin = approach(this.windSpin, 0, 4 * dt);
      this.windFlip = approach(this.windFlip, 0, 4 * dt);
    }
    const steer = charging ? 0 : steerRaw;
    const braking = !charging && inp.down && speed > 1.5;   // ↓ = skid / stop

    // ---- edge angle (rate-limited: it takes time to roll the skis over)
    let edgeTarget;
    if (braking) {
      if (steer !== 0) this.brakeSide = steer;
      edgeTarget = this.brakeSide * 40 * DEG;
    } else {
      edgeTarget = steer * MAX_EDGE * clamp(0.35 + speed / 12, 0, 1);
    }
    this.edge = approach(this.edge, edgeTarget, 3.2 * dt);
    this.tuck = approach(this.tuck, inp.up && !braking && !charging && speed > 3 ? 1 : 0, 4 * dt); // ↑ = tuck

    // ---- travel frame (velocity direction) & slip angle
    const travel = this._t;
    if (speed > 0.3) { copy(travel, v); projectPlane(travel, n); normalize(travel); }
    else { copy(travel, f); scale(travel, dirSign); }
    const along = clamp(Math.abs(dot(travel, f)), 0, 1);
    this.slip = Math.acos(along);
    // signed slip: >0 when skis point right of travel (as seen by the rider)
    const tf = copy(this._tmp, f); scale(tf, dirSign);
    const slipSign = Math.sign(dot(cross(this._g, tf, travel), n)) || 0; // + if travel is left of skis

    // ---- carving: the bent ski tracks an arc and drags the velocity with it
    const aEdge = Math.abs(this.edge);
    const kappa = Math.sin(aEdge) / S.sidecut;                 // 1/R
    const tracking = clamp(1 - this.slip / (30 * DEG), 0, 1);  // ski only tracks if roughly aligned
    const omegaCarve = kappa * Math.abs(vf) * tracking;
    const aReq = omegaCarve * speed;                           // centripetal accel needed
    const aGrip = this.Nacc * (0.3 + S.edgeGrip * Math.tan(Math.min(aEdge, 70 * DEG)));
    const carveFrac = aReq > aGrip ? aGrip / aReq : 1;
    const turnAng = -Math.sign(this.edge) * omegaCarve * dt;   // clockwise about n = right
    rotateAxis(this.heading, n, turnAng);
    rotateAxis(v, n, turnAng * carveFrac);
    this.lean = Math.atan2(omegaCarve * carveFrac * speed, Math.max(1, this.Nacc)) * Math.sign(this.edge);

    // ---- skier steering effort
    if (braking) {
      // hockey stop: twist the skis across the fall line
      const done = slipSign === this.brakeSide && this.slip >= 80 * DEG;
      if (!done) rotateAxis(this.heading, n, -this.brakeSide * 5.0 * dt);
    } else {
      // pivot the skis when slow (stepping / pivot turns)
      const pivot = steer * 2.4 * clamp(1 - speed / 9, 0, 1);
      if (pivot) { rotateAxis(this.heading, n, -pivot * dt); if (speed < 1.5) rotateAxis(v, n, -pivot * dt); }
      // a skier naturally re-aligns skis with the direction of travel
      if (speed > 1 && this.slip > 0.02) {
        const travelAligned = dirSign > 0 ? travel : scale(copy(this._g, travel), -1);
        const sgn = Math.sign(dot(cross(this._tmp, this.heading, travelAligned), n));
        rotateAxis(this.heading, n, sgn * Math.min(this.slip, 2.2 * this.slip * dt + 0.4 * dt));
      }
    }

    // recompute frame after rotations
    copy(f, this.heading); projectPlane(f, n); normalize(f); copy(this.heading, f);
    cross(r, f, n);
    // yaw rate of the skis: carried into the air as spin when you leave the snow
    const yaw = Math.atan2(dot(cross(this._tmp, f, headingBefore), n), dot(f, headingBefore));
    this.yawRate += (yaw / dt - this.yawRate) * 0.3;
    vf = dot(v, f);
    let vr = dot(v, r);
    const vn = dot(v, n);

    // ---- gravity in the slope plane
    const gvec = set(this._g, 0, -g, 0);
    const gn = dot(gvec, n);
    const gf = dot(gvec, f), gr = dot(gvec, r);
    vf += gf * dt;
    vr += gr * dt;

    // ---- skating / pole push on flats
    if (inp.up && !charging && speed < 5 && Math.abs(gf) < 2.5 && !braking) vf += (this.switch ? -1 : 1) * 2.6 * dt;

    // ---- snow friction (Coulomb, ∝ normal force)
    const N = clamp(this.Nacc, 0, 6 * g);
    const powder = T.powder(this.pos.x, this.pos.z);
    const glideMu = S.snowFriction * (1 + 1.5 * powder) + (braking ? 0.05 : 0);
    vf = approach(vf, 0, glideMu * N * dt);
    // sideways: flat ski slips easily, an edged ski bites
    const latMu = S.skidFriction * (0.45 + 0.9 * Math.sin(aEdge));
    const vrBefore = vr;
    vr = approach(vr, 0, latMu * N * dt);
    // power dissipated by the sideways scrub (drives spray + sound)
    this.scrubPower = MASS * Math.abs(vrBefore) * (Math.abs(vrBefore) - Math.abs(vr)) / dt;
    this.skidding = Math.abs(vrBefore) > 1.2 && this.slip > 8 * DEG;
    this.carving = !this.skidding && aEdge > 10 * DEG && carveFrac > 0.98 && speed > 4;

    // ---- air drag (+ powder plowing drag)
    speed = Math.hypot(vf, vr);
    const CdA = (0.55 - 0.33 * this.tuck + (braking ? 0.12 : 0)) * S.dragScale;
    const aDrag = 0.5 * RHO * CdA * speed * speed / MASS + powder * 0.9 * speed;
    if (speed > 1e-3) {
      const k = Math.max(0, 1 - aDrag * dt / speed);
      vf *= k; vr *= k;
    }

    // reassemble velocity; add gravity's normal component (pushes into snow)
    set(v, 0, 0, 0);
    addScaled(v, f, vf); addScaled(v, r, vr); addScaled(v, n, vn + gn * dt);

    // ---- catching an edge: edge tipped *into* a big sideways slide
    const latTravel = vr * dirSign; // + = sliding toward travel-right
    if (speed > 7 && Math.abs(latTravel) > 5 && Math.sign(this.edge) === Math.sign(latTravel) && aEdge > 18 * DEG) {
      this.doCrash('Caught an edge!');
      return;
    }

    // ---- ollie: hold to crouch, release to pop off the snow
    if (inp.jump) this.charge = Math.min(0.5, this.charge + dt);
    const popped = !inp.jump && this.jumpWasHeld && this.charge > 0;
    this.jumpWasHeld = inp.jump;

    // ---- integrate & resolve ground contact
    if (popped) {
      this._ws = this.windSpin; this._wf = this.windFlip;
      const pop = S.popStrength * (1.5 + 2.4 * (this.charge / 0.5));
      addScaled(v, n, pop);
      this.charge = 0;
    }
    addScaled(this.pos, v, dt);
    this.resolveGround(dt, inp, popped);
    if (!this.grounded && popped) this.releaseWind(this._ws, this._wf);
  }

  resolveGround(dt, inp, popped) {
    const T = this.terrain;
    const gy = T.height(this.pos.x, this.pos.z);
    if (!popped && this.pos.y <= gy + 1e-4) {
      this.pos.y = gy;
      const n = T.normal(this.pos.x, this.pos.z, this.n);
      const vn = dot(this.vel, n);
      let Ninst = 0;
      if (vn < 0) { addScaled(this.vel, n, -vn); Ninst = -vn / dt; }
      // smooth the measured normal force a little (snow/knees are not rigid)
      this.Nacc += (Ninst - this.Nacc) * 0.35;
      if (Ninst > 9 * this.S.gravity && this.speed() > 12) this.doCrash('Slammed into the slope');
    } else {
      this.takeoff(inp, false);
    }
  }

  takeoff(inp, popped) {
    this.grounded = false;
    this.airTime = 0;
    this.spin = 0; this.flip = 0;
    // Rotation is decided on the snow: whatever the skis were already turning
    // at (a carve) plus the wind-up you release with the pop. In the air you
    // can only fine-tune it (arms, tucking tighter).
    this.spinMom = this.yawRate * 0.8;
    this.airArm = { left: !inp.left, right: !inp.right, up: !inp.up, down: !inp.down };
    this.flipMom = 0;
    if (popped) this.releaseWind();
    else if (inp.jump && this.charge > 0) this.coyote = { charge: this.charge, spin: this.windSpin, flip: this.windFlip };
    this.windSpin = 0; this.windFlip = 0;
    this.grabTime = 0; this.grabbing = false;
    this.maxAirHeight = 0;
    this.charge = 0;
    this.Nacc = 0;
  }

  releaseWind(spin = this.windSpin, flip = this.windFlip) {
    const S = this.S;
    this.spinMom += spin * 7.5 * S.spinRate;
    this.flipMom += flip * 6.0 * S.spinRate;
  }

  // ---------------------------------------------------------------------
  stepAir(dt, inp) {
    const S = this.S, T = this.terrain;
    const v = this.vel;
    this.airTime += dt;
    v.y -= S.gravity * dt;
    const speed = len(v);
    const CdA = (0.55 - 0.25 * this.tuck) * S.dragScale;
    const aDrag = 0.5 * RHO * CdA * speed * speed / MASS;
    if (speed > 1e-3) scale(v, Math.max(0, 1 - aDrag * dt / speed));

    // late pop: releasing the ollie just after leaving the lip still counts
    if (this.coyote && !inp.jump) {
      if (this.airTime < 0.2) {
        addScaled(v, this.n, S.popStrength * (1.5 + 2.4 * (this.coyote.charge / 0.5)));
        this.releaseWind(this.coyote.spin, this.coyote.flip);
      }
      this.coyote = null;
    }
    this.jumpWasHeld = inp.jump;

    // Angular momentum is conserved. Arms give a small corrective torque
    // (strength = "Air control" setting); grabbing pulls the body in, which
    // lowers the moment of inertia and speeds the rotation up (like a skater).
    // keys still held from the snow (tuck, a turn) don't count until pressed again
    const A = this.airArm;
    for (const k of ['left', 'right', 'up', 'down']) if (!inp[k]) A[k] = true;
    const steer = (inp.right && A.right ? 1 : 0) - (inp.left && A.left ? 1 : 0);
    const flipIn = (inp.down && A.down ? 1 : 0) - (inp.up && A.up ? 1 : 0); // down = front flip, up = back flip
    this.grabbing = !!inp.grab;
    if (this.grabbing) this.grabTime += dt;
    const torque = 2.0 * S.airControl * dt;
    const spinMax = 7.5 * S.spinRate, flipMax = 6.0 * S.spinRate;
    if (steer) this.spinMom = clamp(this.spinMom + steer * torque, -spinMax, spinMax);
    if (flipIn) this.flipMom = clamp(this.flipMom + flipIn * torque, -flipMax, flipMax);
    const inertia = this.grabbing ? 1 / 1.3 : 1;
    this.spinRate = this.spinMom / inertia;
    this.flipRate = this.flipMom / inertia;
    this.spin += this.spinRate * dt;
    this.flip += this.flipRate * dt;
    rotateAxis(this.heading, { x: 0, y: 1, z: 0 }, -this.spinRate * dt);
    this.tuck = approach(this.tuck, 0, 3 * dt);

    addScaled(this.pos, v, dt);
    const gy = T.height(this.pos.x, this.pos.z);
    this.maxAirHeight = Math.max(this.maxAirHeight, this.pos.y - gy);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      this.land();
    }
  }

  land() {
    const S = this.S, T = this.terrain;
    const n = T.normal(this.pos.x, this.pos.z, this.n);
    const v = this.vel;
    const vn = dot(v, n);
    const impact = Math.max(0, -vn);
    this.lastImpact = impact;

    // residual rotation: flips must come round to ~0, spins to a multiple of 180°
    const flipRes = wrapPi(this.flip);
    const halfTurns = Math.round(this.spin / Math.PI);
    const spinRes = this.spin - halfTurns * Math.PI;
    const airTime = this.airTime;

    const tangential = Math.sqrt(Math.max(0, dot(v, v) - vn * vn));
    let reason = null;
    if (impact > S.landingTolerance) reason = impact > S.landingTolerance * 1.6 ? 'Flat landing — legs gave out' : 'Landed too hard';
    else if (Math.abs(flipRes) > 55 * DEG) reason = flipRes > 0 ? 'Over-rotated' : 'Under-rotated';
    else if (Math.abs(spinRes) > 40 * DEG && tangential > 4) reason = 'Landed sideways';

    const quality = 1 - Math.max(impact / S.landingTolerance, Math.abs(flipRes) / (55 * DEG), Math.abs(spinRes) / (40 * DEG));
    const info = {
      type: 'land', airTime, spin: this.spin, flip: this.flip, grabTime: this.grabTime,
      impact, quality: clamp(quality, 0, 1), height: this.maxAirHeight, speed: len(v), crashed: !!reason,
    };

    if (reason) {
      this.events.push(info);
      this.doCrash(reason);
      return;
    }

    // absorb the impact: kill normal velocity; friction during the impulse costs a bit of speed
    addScaled(v, n, -vn);
    const loss = Math.min(tangential, 0.12 * impact + Math.abs(spinRes) * 3);
    if (tangential > 1e-3) scale(v, (tangential - loss) / tangential);
    this.grounded = true;
    this.Nacc = S.gravity;
    this.flip = 0; this.spin = 0; this.spinRate = 0; this.flipRate = 0; this.spinMom = 0; this.flipMom = 0; this.yawRate = 0;
    this.grabbing = false;
    projectPlane(this.heading, n); normalize(this.heading);
    this.events.push(info);
  }

  collideTrees() {
    const p = this.pos;
    const cx = Math.floor(p.x / 10), cz = Math.floor(p.z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.treeGrid.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      for (const t of list) {
        const dx = p.x - t.x, dz = p.z - t.z;
        const d = Math.hypot(dx, dz);
        const rr = t.r + 0.35;
        if (d < rr && p.y < this.terrain.height(t.x, t.z) + t.h) {
          const nx = dx / (d || 1), nz = dz / (d || 1);
          const into = -(this.vel.x * nx + this.vel.z * nz);
          if (into > 4.5) { this.doCrash('Hit a tree'); return; }
          p.x = t.x + nx * rr; p.z = t.z + nz * rr;
          if (into > 0) { this.vel.x += nx * into; this.vel.z += nz * into; }
        }
      }
    }
  }

  doCrash(reason) {
    if (this.crashed) return;
    this.crashed = true;
    this.events.push({ type: 'crash', reason });
  }

  slopeAngle() { return Math.acos(clamp(this.n.y, -1, 1)); }
}
