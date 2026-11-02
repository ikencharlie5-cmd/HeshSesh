# HeshSesh

A solo browser ski game built around **physics, not graphics**. It uses low-poly Three.js visuals and a custom ski-physics model.
No build step: it's a static site.

## Run it

Any static file server works. From the repo folder:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080 in Chrome. (`npm run dev` does the same thing.) Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

To host it, push the folder to any static host (GitHub Pages, Netlify, etc.). Three.js is vendored in `vendor/`, so it doesn't need a CDN.

## Modes

- **Mountain**: a hand-built freeride mountain about 1.6 km long. It has:
  - a summit and an open powder bowl (deep snow is slower)
  - a groomed main run, two natural gullies, and two cliff bands with rock faces
  - forests that get thicker lower down
  - natural booters scattered on the runs
  - a four-table **Jump Line** (S/M/L/XL, with blue-dyed lips and knuckles)
  
  There are 7 checkpoints: keys 1–7, or T for the top.
- **Test Slope**: one run with a kicker and a roller, for tuning physics.
- **Terrain Park**: one linear line from the top down.
  - a rail garden: flat box, flat-down rail, down rail, kinked rail and long box, each ride-on from a small snow ramp
  - three tables (S/M/L) tuned to land at natural speed
  - a ~5 m superpipe

## Controls

| Key | Ground | Air |
|---|---|---|
| ← / → | Roll skis on edge and turn. More edge gives a tighter carve | Spin |
| ↑ | Tuck (less drag). At low speed it skates / pole-pushes instead | Back flip (nudge) |
| ↓ | Skid / hockey stop. ←/→ picks the side | Front flip (nudge) |
| Space | Hold to crouch, release to ollie. Releasing right at a lip adds pop | |
| Shift / G | | Grab |
| R | Respawn at the last checkpoint | |
| 1–4 | Jump to a checkpoint | |
| P | Physics settings panel | |
| M / Esc | Mute / menu | |

WASD also works.

**Air is arcade style.**
- Hold an arrow to rotate around your own body: ←/→ spin, ↑ backflip, ↓ frontflip.
- Hold a spin and a flip together and they blend into one off-axis rotation (a cork, or a rodeo going forward).
- Let go and you settle, lining your skis up with the snow under you.
- Landings are forgiving. You only crash on a huge impact or landing on your head or back. Landing sideways just turns into a skid.
- There's no score: the game just calls out what you did.

**Rails and boxes.**
- Land on them, or ride onto them from the snow ramp.
- You slide with gravity and rail friction while balancing. ←/→ shifts your weight, and the meter shows your lean.
- Lean too far and you slip off (no crash). Press Space to pop off the end.
- Come in with your skis across the rail for a slide, or along it for a grind.

## The physics model (`src/skier.js`)

The skier is a 75 kg point mass with a ski heading and an edge angle. The ground is an analytic height field, so contact is exact.

- **Gravity** is projected onto the local slope plane, so speed comes from slope angle. Flats and uphills bleed speed.
- **Snow friction** is Coulomb friction, proportional to the *measured* normal force. Compressions load you up and add friction. Rollovers unweight you.
- **Anisotropic ski**: there is low friction along the ski (glide μ ≈ 0.045) and high friction across it (skid μ). Sliding sideways turns kinetic energy into heat, and that is the speed you lose in a skid.
- **Carving**: an edged ski bends into an arc of radius ≈ sidecut / sin(edge). That rotates your velocity with no friction loss, as long as the edge can supply the centripetal force (v²/R ≤ grip·N). Over-edge at speed and the ski washes out into a skid.
- **Catching an edge**: if you tip your edge *into* a big sideways slide, you go down.
- **Air drag** is ½ρC<sub>d</sub>Av². Tucking cuts frontal area by about 60%, which takes terminal speed on the steep from ~110 to ~170 km/h.
- **Airtime** is plain ballistics. You leave the snow when the ground curves away faster than gravity can follow (v²κ > g·cosθ). So jump height depends on takeoff speed and lip angle.
- **Landings**: impact = the velocity component *into* the landing surface. Matching the slope is soft and flat-landing is brutal. Leftover rotation and landing sideways also crash you.
- **Crashes** hand your joint positions and momentum to a Verlet ragdoll (`src/ragdoll.js`), which tumbles until it settles. Then you respawn.

Everything above is tunable live in the **⚙ Physics** panel: gravity, glide friction, drag, edge grip, sidecut radius, skid friction, landing tolerance, pop, spin speed and time scale.

## Tests

```bash
node tests/physics-sim.js
```

```bash
node tests/mountain-sim.js
```

```bash
node tests/park-sim.js
```

This runs scripted skiers down the slope headlessly (no browser) and prints speeds, airtime, impacts and crashes. It's handy for checking that a tuning change still feels physically sane.

## Layout

```
index.html, style.css     UI shell (menu, HUD, settings)
src/main.js               loop (fixed 120 Hz physics), camera, HUD, events
src/skier.js              ski physics
src/terrain.js            test slope + tree spatial hash
src/mountain.js           freeride mountain (height, features, trees, checkpoints)
src/features.js           kickers / tables / booters as height offsets
src/park.js               terrain park (rails, tables, halfpipe)
src/world.js              terrain, feature, rail, tree, rock and mountain-range meshes
src/skierModel.js         procedural low-poly skier
src/ragdoll.js            Verlet crash ragdoll
src/tricks.js             trick naming + scoring
src/fx.js, src/audio.js   snow spray, ski tracks, blob shadow, wind/scrape sound
vendor/                   three.js r170 (MIT)
```
