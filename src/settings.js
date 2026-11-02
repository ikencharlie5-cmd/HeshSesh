// Physics tuning knobs exposed in the settings panel. Persisted per browser.

export const SETTINGS_SPEC = [
  { key: 'gravity',        label: 'Gravity',            unit: 'm/s²', min: 2,    max: 20,  step: 0.01,  def: 9.81,
    help: 'Earth is 9.81. Lower = floaty moon skiing.' },
  { key: 'snowFriction',   label: 'Snow friction (glide μ)', unit: '', min: 0,  max: 0.2, step: 0.005, def: 0.045,
    help: 'Kinetic friction along the ski. Waxed skis on cold snow ≈ 0.03–0.06.' },
  { key: 'dragScale',      label: 'Air drag',           unit: '×',    min: 0,    max: 3,   step: 0.05,  def: 1.0,
    help: 'Multiplier on ½ρC<sub>d</sub>Av². Tucking cuts frontal area by ~60%.' },
  { key: 'edgeGrip',       label: 'Edge grip',          unit: '',     min: 0.2,  max: 3,   step: 0.05,  def: 1.4,
    help: 'How much sideways force an edged ski holds before it washes out into a skid.' },
  { key: 'sidecut',        label: 'Ski sidecut radius', unit: 'm',    min: 8,    max: 40,  step: 0.5,   def: 16,
    help: 'Smaller = tighter carved turns (slalom ski ≈ 12 m, GS ≈ 25 m).' },
  { key: 'skidFriction',   label: 'Skid friction',      unit: '',     min: 0.1,  max: 1.5, step: 0.05,  def: 0.9,
    help: 'Friction when the ski slides sideways. Higher = skids scrub more speed.' },
  { key: 'landingTolerance', label: 'Landing tolerance', unit: 'm/s', min: 3,    max: 40,  step: 0.5,   def: 20,
    help: 'Max impact speed into the slope your legs can absorb before you crash.' },
  { key: 'popStrength',    label: 'Ollie pop',          unit: '×',    min: 0,    max: 3,   step: 0.05,  def: 1.0, help: '' },
  { key: 'spinRate',       label: 'Spin / flip speed', unit: '×',   min: 0.3,  max: 2.5, step: 0.05,  def: 1.0,
    help: 'How fast you rotate in the air.' },
  { key: 'airControl',     label: 'Air control',        unit: '×',    min: 0.2,  max: 3,   step: 0.1,   def: 1.0,
    help: 'How quickly rotation starts and stops when you press/release.' },
  { key: 'simSpeed',       label: 'Time scale',         unit: '×',    min: 0.1,  max: 1.5, step: 0.05,  def: 1.0,
    help: 'Slow-mo for studying jumps.' },
];

const KEY = 'heshsesh.settings.v3';

export function loadSettings() {
  const s = {};
  for (const p of SETTINGS_SPEC) s[p.key] = p.def;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const p of SETTINGS_SPEC) if (typeof saved[p.key] === 'number') s[p.key] = saved[p.key];
    }
  } catch (_) { /* storage blocked: use defaults */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
}

export function defaultSettings() {
  const s = {};
  for (const p of SETTINGS_SPEC) s[p.key] = p.def;
  return s;
}
