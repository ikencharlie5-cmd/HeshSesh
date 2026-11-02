// Turn a landing event into a trick name + score.
// Rotation is measured, not chosen from a list: you get credit for the
// half-turns / full flips you actually completed, scaled by how clean the
// landing was (impact into the slope + leftover rotation).

export function scoreLanding(e) {
  const halfTurns = Math.round(Math.abs(e.spin) / Math.PI);
  const flips = Math.round(Math.abs(e.flip) / (2 * Math.PI));
  const spinDeg = halfTurns * 180;
  const grab = e.grabTime > 0.15;
  const parts = [];

  if (flips > 0) {
    const mult = ['', '', 'Double ', 'Triple ', 'Quad '][Math.min(flips, 4)];
    const dir = e.flip < 0 ? 'Back' : 'Front';
    parts.push(spinDeg ? `${mult}${dir} ${spinDeg}` : `${mult}${dir}flip`);
  } else if (spinDeg) {
    parts.push(`${e.spin > 0 ? 'Right' : 'Left'} ${spinDeg}`);
  }
  if (grab) parts.push(e.grabTime > 0.6 ? 'Tweaked Safety' : 'Safety');

  let score = spinDeg / 180 * 100 + flips * 400 + (grab ? 100 + 150 * Math.min(e.grabTime, 1.5) : 0);
  const trick = parts.length > 0;
  if (!trick) {
    if (e.airTime < 0.6) return null;
    parts.push(e.airTime > 1.6 ? 'Big Air' : 'Air');
  }
  score += 60 * e.airTime + 25 * Math.max(0, e.height);

  let grade, mult;
  if (e.quality > 0.6) { grade = 'Clean!'; mult = 1; }
  else if (e.quality > 0.3) { grade = 'Solid'; mult = 0.75; }
  else { grade = 'Sketchy'; mult = 0.4; }
  if (halfTurns % 2 === 1) parts.push('→ switch');

  return {
    name: parts.join(' · '),
    grade,
    score: Math.round(score * mult / 10) * 10,
    air: e.airTime, height: e.height,
  };
}
