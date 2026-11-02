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
  rotateAxis, clamp, wrapPi, approach, quat, qmul, qnorm, qaxis, qrot, qbasis, qtoward,
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
    this.reset(v3(0, 0, -10), v3(0, 0, -1));
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
    this.q = quat();
    this.grind = null; this.railCooldown = 0;
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
    if (this.railCooldown > 0) this.railCooldown -= dt;
    if (this.grind) { this.stepGrind(dt, input); return; }
    if (this.grounded) this.stepGround(dt, input);
    else this.stepAir(dt, input);
    this.collideTrees();
    // world bounds
    const B = this.terrain.bounds;
    if (this.pos.z < B.minZ) { this.pos.z = B.minZ; if (this.vel.z < 0) this.vel.z = 0; }
    if (this.pos.z > B.maxZ) { this.pos.z = B.maxZ; if (this.vel.z > 0) this.vel.z = 0; }
    if (this.pos.x < B.minX + 1) { this.pos.x = B.minX + 1; if (this.vel.x < 0) this.vel.x = 0; }
    if (this.pos.x > B.maxX - 1) { this.pos.x = B.maxX - 1; if (this.vel.x > 0) this.vel.x = 0; }
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
    const steerRaw = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    this.windSpin = 0; this.windFlip = 0;
    const steer = steerRaw;
    const braking = inp.down && speed > 1.5;   // ↓ = skid / stop

    // ---- edge angle (rate-limited: it takes time to roll the skis over)
    let edgeTarget;
    if (braking) {
      if (steer !== 0) this.brakeSide = steer;
      edgeTarget = this.brakeSide * 40 * DEG;
    } else {
      edgeTarget = steer * MAX_EDGE * clamp(0.35 + speed / 12, 0, 1);
    }
    this.edge = approach(this.edge, edgeTarget, 3.2 * dt);
    this.tuck = approach(this.tuck, inp.up && !braking && speed > 3 ? 1 : 0, 4 * dt); // ↑ = tuck

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
    if (inp.up && speed < 5 && Math.abs(gf) < 2.5 && !braking) vf += (this.switch ? -1 : 1) * 2.6 * dt;

    // ---- snow friction (Coulomb, ∝ normal force)
    const N = clamp(this.Nacc, 0, 6 * g);
    const powder = T.powder(this.pos.x, this.pos.z);
    const glideMu = S.snowFriction * (1 + 1.2 * powder) + (braking ? 0.05 : 0);
    this.powder = powder;
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
    const aDrag = 0.5 * RHO * CdA * speed * speed / MASS + powder * 0.09 * speed;
    if (speed > 1e-3) {
      const k = Math.max(0, 1 - aDrag * dt / speed);
      vf *= k; vr *= k;
    }

    // reassemble velocity; add gravity's normal component (pushes into snow)
    set(v, 0, 0, 0);
    addScaled(v, f, vf); addScaled(v, r, vr); addScaled(v, n, vn + gn * dt);

    // ---- catching an edge: edge tipped *into* a big sideways slide
    const latTravel = vr * dirSign; // + = sliding toward travel-right
    if (speed > 10 && Math.abs(latTravel) > 7 && Math.sign(this.edge) === Math.sign(latTravel) && aEdge > 25 * DEG) {
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
    const prevY = this.pos.y;
    this.resolveGround(dt, inp, popped);
    if (this.grounded) this.checkRails(prevY, inp);
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
      if (this.Nacc > 10 * this.S.gravity && this.speed() > 15) this.doCrash('Slammed into the slope');
    } else {
      this.takeoff(inp, false);
    }
  }

  takeoff(inp, popped) {
    this.grounded = false;
    this.airTime = 0;
    this.spin = 0; this.flip = 0;
    this.spinRate = 0; this.flipRate = 0;
    this.airArm = { left: true, right: true, up: !inp.up, down: !inp.down };
    this.coyote = (!popped && inp.jump && this.charge > 0) ? { charge: this.charge } : null;
    this.windSpin = 0; this.windFlip = 0;
    this.grabTime = 0; this.grabbing = false;
    this.maxAirHeight = 0;
    this.charge = 0;
    this.Nacc = 0;
    // body orientation leaves the snow exactly as it was on the snow
    this.bodyFromBasis(this.q, this.heading, this.n);
    // a vertical wall (halfpipe) sends you straight up, like a real vert wall
    if (this.terrain.pipeAssist) this.terrain.pipeAssist(this.pos, this.vel);
  }

  // q from forward + up, body frame: x = left, y = up, z = forward
  bodyFromBasis(q, fwd, up) {
    const Z = normalize(projectPlane(copy(this._qa || (this._qa = v3()), fwd), up));
    if (len(fwd) < 1e-6) set(Z, 0, 0, -1);
    const Y = copy(this._qb || (this._qb = v3()), up);
    const X = normalize(cross(this._qc || (this._qc = v3()), Y, Z));
    cross(Z, X, Y);
    return qbasis(q, X, Y, Z);
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
      if (this.airTime < 0.2) addScaled(v, this.n, S.popStrength * (1.5 + 2.4 * (this.coyote.charge / 0.5)));
      this.coyote = null;
    }
    this.jumpWasHeld = inp.jump;

    // Arcade air. Rotation happens around your own body axes: ←/→ spin around
    // your spine, ↑/↓ flip head-over-heels. Hold both and the two combine into one
    // smooth off-axis rotation (a cork / misty / rodeo). Let go and the rotation
    // eases off while you settle to line up with the snow under you.
    const A = this.airArm;
    for (const k of ['left', 'right', 'up', 'down']) if (!inp[k]) A[k] = true;
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const flipIn = (inp.down && A.down ? 1 : 0) - (inp.up && A.up ? 1 : 0); // ↓ front flip, ↑ back flip
    this.grabbing = !!inp.grab;
    if (this.grabbing) this.grabTime += dt;
    const boost = this.grabbing ? 1.15 : 1;
    const spinMax = 10 * S.spinRate * boost, flipMax = 8 * S.spinRate * boost;
    const acc = 50 * S.airControl;
    this.spinRate = approach(this.spinRate, steer * spinMax, (steer ? acc : acc * 0.6) * dt);
    this.flipRate = approach(this.flipRate, flipIn * flipMax, (flipIn ? acc : acc * 0.6) * dt);
    const q = this.q, dq = this._dq || (this._dq = quat());
    qmul(q, q, qaxis(dq, 0, 1, 0, -this.spinRate * dt));  // spin about body up (+rate = to the right)
    qmul(q, q, qaxis(dq, 1, 0, 0, this.flipRate * dt));   // flip about body left axis (+rate = nose down)
    qnorm(q);
    this.spin += this.spinRate * dt;
    this.flip += this.flipRate * dt;

    if (!steer && !flipIn) {
      // settle: line the skis up with your motion over the snow below you
      const nb = T.normal(this.pos.x, this.pos.z, this._nb || (this._nb = v3()));
      const fwd = qrot(this._fw || (this._fw = v3()), q, 0, 0, 1);
      const tgt = projectPlane(copy(this._tg || (this._tg = v3()), v), nb);
      if (len(tgt) < 0.5) copy(tgt, fwd);
      if (dot(tgt, fwd) < 0) scale(tgt, -1);              // forward or switch, whichever is closer
      const qt = this.bodyFromBasis(this._qt || (this._qt = quat()), tgt, nb);
      const settle = 4.5 * S.airControl * (1 + Math.min(2, this.airTime));
      qtoward(q, qt, settle * dt * Math.max(0.15, 1 - Math.hypot(this.spinRate, this.flipRate) / 8));
    }
    // heading follows the body (used for trees, camera, landing)
    qrot(this.heading, q, 0, 0, 1);
    this.tuck = approach(this.tuck, 0, 3 * dt);

    const prevY = this.pos.y;
    addScaled(this.pos, v, dt);
    if (this.checkRails(prevY, inp)) return;
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
    const up = qrot(this._up || (this._up = v3()), this.q, 0, 1, 0);
    const fwd = qrot(this._fw || (this._fw = v3()), this.q, 0, 0, 1);
    const tilt = Math.acos(clamp(dot(up, n), -1, 1));

    // Forgiving: you only go down for a truly brutal impact or landing on your head/back.
    let reason = null;
    if (impact > S.landingTolerance) reason = 'Too much impact';
    else if (tilt > 115 * DEG) reason = up.y < 0 ? 'Landed on your head' : 'Landed on your back';

    const info = {
      type: 'land', airTime: this.airTime, spin: this.spin, flip: this.flip, grabTime: this.grabTime,
      impact, tilt, height: this.maxAirHeight, speed: len(v), crashed: !!reason,
    };
    if (reason) { this.events.push(info); this.doCrash(reason); return; }

    // absorb: kill the into-slope velocity; a sketchy landing scrubs a bit of speed
    addScaled(v, n, -vn);
    const tangential = len(v);
    const loss = Math.min(tangential * 0.5, 0.06 * impact + (tilt > 50 * DEG ? 0.15 * tangential : 0));
    if (tangential > 1e-3) scale(v, (tangential - loss) / tangential);
    // skis land wherever they point: landing sideways is just a skid, not a crash
    copy(this.heading, fwd); projectPlane(this.heading, n);
    if (len(this.heading) < 0.2) { copy(this.heading, v); projectPlane(this.heading, n); }
    normalize(this.heading);
    this.grounded = true;
    this.Nacc = S.gravity;
    this.spinRate = 0; this.flipRate = 0; this.yawRate = 0;
    this.grabbing = false;
    this.events.push(info);
  }

  // ---------------------------------------------------------------------
  // Rails and boxes: you lock on when your skis come down onto (or ride onto)
  // the top. Then you slide with gravity and rail friction, and balance an
  // inverted pendulum: ←/→ shift your weight. Lean too far and you slide off.
  checkRails(prevY, inp) {
    const rails = this.terrain.rails;
    if (!rails || this.railCooldown > 0) return false;
    const p = this.pos, v = this.vel;
    for (const r of rails) {
      for (let i = 0; i < r.segs.length; i++) {
        const sg = r.segs[i];
        const qx = p.x - sg.a.x, qz = p.z - sg.a.z;
        const t = (qx * sg.hx + qz * sg.hz) / sg.hlen;
        if (t < -0.02 || t > 1.02) continue;
        const lat = Math.abs(qx * sg.hz - qz * sg.hx);
        const fwdLat = Math.abs(this.heading.x * sg.hz - this.heading.z * sg.hx); // |sin| skis vs rail
        if (lat > r.halfW + 0.2 + 0.45 * fwdLat) continue;
        const top = sg.a.y + (sg.b.y - sg.a.y) * clamp(t, 0, 1);
        const onTop = this.grounded
          ? Math.abs(p.y - top) < 0.3
          : prevY >= top - 0.08 && p.y <= top + 0.12 && v.y <= 1.5;
        if (!onTop) continue;
        const sign = v.x * sg.hx + v.z * sg.hz >= 0 ? 1 : -1;
        const along = (v.x * sg.d.x + v.y * sg.d.y + v.z * sg.d.z) * sign;
        if (along < 1) continue;
        // stance: snap the angle between skis and rail to 0 / 90 / 180°
        const tx = sg.hx / sg.hl * sign, tz = sg.hz / sg.hl * sign;
        const fx = this.heading.x, fz = this.heading.z;
        const ang = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz);
        const stance = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
        const latV = (v.x * -tz + v.z * tx);
        this.grind = {
          r, i, s: clamp(t, 0, 1) * sg.len, sign, v: along, stance, phi: 0, phiDot: clamp(latV * 0.35, -1.5, 1.5),
          time: 0, dist: 0,
        };
        this.grounded = false;
        this.events.push({ type: 'grindStart', rail: r.name });
        this.stepGrindPose();
        return true;
      }
    }
    return false;
  }

  stepGrind(dt, inp) {
    const G = this.grind, S = this.S, g = S.gravity;
    const r = G.r;
    let sg = r.segs[G.i];
    const tx = sg.d.x * G.sign, ty = sg.d.y * G.sign, tz = sg.d.z * G.sign;
    // gravity along the rail minus sliding friction
    const N = g * Math.sqrt(Math.max(0, 1 - ty * ty));
    G.v += (-g * ty - r.mu * N) * dt;
    G.v -= 0.5 * RHO * 0.5 * S.dragScale * G.v * G.v / MASS * dt;
    G.time += dt;
    G.dist += G.v * dt;
    G.s += G.v * dt * G.sign;
    // balance: an unstable pendulum with random wobble; ←/→ to correct
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const unstable = r.kind === 'rail' ? 2.6 : 1.2;
    let acc = unstable * Math.sin(G.phi) + (Math.random() - 0.5) * (r.kind === 'rail' ? 22 : 12) * (0.5 + G.v / 12)
      + steer * 9 - 1.8 * G.phiDot;
    if (r.kind === 'box' && Math.abs(G.phi) < 0.15) acc -= 6 * G.phi; // wide box: a little self-centering
    G.phiDot += acc * dt;
    G.phi += G.phiDot * dt;

    const popped = !inp.jump && this.jumpWasHeld;
    this.jumpWasHeld = inp.jump;
    // walk across segment ends
    while (G.s > sg.len || G.s < 0) {
      const next = G.i + G.sign;
      if (next < 0 || next >= r.segs.length) return this.leaveRail(inp, 'end');
      G.s = G.s > sg.len ? G.s - sg.len : G.s + r.segs[next].len;
      G.i = next; sg = r.segs[G.i];
    }
    if (popped) return this.leaveRail(inp, 'pop');
    if (Math.abs(G.phi) > 0.8) return this.leaveRail(inp, 'fell');
    if (G.v < 0.4) return this.leaveRail(inp, 'stall');
    this.stepGrindPose();
  }

  stepGrindPose() {
    const G = this.grind, sg = G.r.segs[G.i];
    set(this.pos, sg.a.x + sg.d.x * G.s, sg.a.y + sg.d.y * G.s, sg.a.z + sg.d.z * G.s);
    const t = set(this._t, sg.d.x * G.sign, sg.d.y * G.sign, sg.d.z * G.sign);
    set(this.vel, t.x * G.v, t.y * G.v, t.z * G.v);
    // skis across or along the rail, tipped by the balance angle
    set(this.n, 0, 1, 0);
    const th = normalize(set(this._tmp, t.x, 0, t.z));
    rotateAxis(this.n, th, G.phi);
    copy(this.heading, th);
    rotateAxis(this.heading, { x: 0, y: 1, z: 0 }, G.stance);
    this.lean = 0; this.edge = 0;
  }

  leaveRail(inp, why) {
    const G = this.grind;
    this.grind = null;
    this.railCooldown = 0.3;
    const sg = G.r.segs[G.i];
    if (why === 'fell') {
      // slip off the side you were leaning toward
      const side = normalize(set(this._tmp, -sg.hz * G.sign, 0, sg.hx * G.sign));
      addScaled(this.vel, side, -Math.sign(G.phi) * 2);
    }
    if (why === 'pop') addScaled(this.vel, { x: 0, y: 1, z: 0 }, 3.5 * this.S.popStrength);
    else addScaled(this.vel, { x: 0, y: 1, z: 0 }, 0.6);
    this.events.push({ type: 'grind', rail: G.r.name, kind: G.r.kind, stance: G.stance, time: G.time, dist: G.dist, fell: why === 'fell' });
    set(this.n, 0, 1, 0);
    this.takeoff(inp, true);
  }

  collideTrees() {
    const p = this.pos;
    {
      for (const t of this.terrain.treesNear(p.x, p.z)) {
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
