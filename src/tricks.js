// Name what you just did. No points, no grades: just a callout.
// Rotation is measured around your own body axes, so spin + flip together
// reads as a cork.

export function nameLanding(e) {
  const halfTurns = Math.round(Math.abs(e.spin) / Math.PI);
  const flips = Math.round(Math.abs(e.flip) / (2 * Math.PI));
  const spinDeg = halfTurns * 180;
  const parts = [];
  const mult = ['', '', 'Double ', 'Triple ', 'Quad '][Math.min(flips, 4)];
  if (flips > 0 && spinDeg >= 360) parts.push(`${mult}${e.flip < 0 ? 'Cork' : 'Rodeo'} ${spinDeg}`);
  else if (flips > 0 && spinDeg) parts.push(`${mult}${e.flip < 0 ? 'Back' : 'Front'} ${spinDeg}`);
  else if (flips > 0) parts.push(`${mult}${e.flip < 0 ? 'Backflip' : 'Frontflip'}`);
  else if (spinDeg) parts.push(`${spinDeg}`);
  if (e.grabTime > 0.15) parts.push(e.grabTime > 0.6 ? 'tweaked grab' : 'grab');
  if (!parts.length) return e.airTime > 1.4 ? 'Send it' : null;
  return parts.join(' · ');
}

export function nameGrind(e) {
  if (e.fell || e.time < 0.25) return null;
  const across = Math.abs(Math.abs(e.stance) - Math.PI / 2) < 0.1;
  const sw = Math.abs(Math.abs(e.stance) - Math.PI) < 0.1;
  const style = across ? 'Slide' : sw ? 'Switch grind' : 'Grind';
  return `${style} · ${e.rail} · ${e.dist.toFixed(0)} m`;
}
