// Terminal numbers follow the 536631 circuit layout (page 2).
export const signals = [
  { id: 'I1', terminal: 5, group: 'input', label: 'Vandret reference' },
  { id: 'I2', terminal: 6, group: 'input', label: 'Indre lysbom' },
  { id: 'I3', terminal: 7, group: 'input', label: 'Ydre lysbom' },
  { id: 'I4', terminal: 8, group: 'input', label: 'Lodret reference' },
  { id: 'A1', terminal: 9, group: 'track', label: 'Nederste sporsensor' },
  { id: 'A2', terminal: 10, group: 'track', label: 'Øverste sporsensor' },
  { id: 'B1', terminal: 11, group: 'encoder', label: 'Vandret enkoder · spor 1' },
  { id: 'B2', terminal: 12, group: 'encoder', label: 'Vandret enkoder · spor 2' },
  { id: 'B3', terminal: 13, group: 'encoder', label: 'Lodret enkoder · spor 1' },
  { id: 'B4', terminal: 14, group: 'encoder', label: 'Lodret enkoder · spor 2' },
  { id: 'I5', terminal: 15, group: 'input', label: 'Gaffel helt fremme' },
  { id: 'I6', terminal: 16, group: 'input', label: 'Gaffel trukket tilbage' },
  { id: 'Q1', terminal: 17, group: 'output', motor: 'M1', label: 'Transportbånd frem' },
  { id: 'Q2', terminal: 18, group: 'output', motor: 'M1', label: 'Transportbånd tilbage' },
  { id: 'Q3', terminal: 19, group: 'output', motor: 'M2', label: 'Kør mod reolen' },
  { id: 'Q4', terminal: 20, group: 'output', motor: 'M2', label: 'Kør mod transportbåndet' },
  { id: 'Q5', terminal: 21, group: 'output', motor: 'M3', label: 'Sænk gaflen' },
  { id: 'Q6', terminal: 22, group: 'output', motor: 'M3', label: 'Løft gaflen' },
  { id: 'Q7', terminal: 23, group: 'output', motor: 'M4', label: 'Skub gaflen frem' },
  { id: 'Q8', terminal: 24, group: 'output', motor: 'M4', label: 'Træk gaflen tilbage' },
];

// X runs from the transfer station towards the farthest column. Y runs upwards.
// The fork must pass under each carrier, lift it clear, and lower it onto its support.
const beltHeight = 0.16;
const bayX = 2 / 3;
const bayHeight = 0.5;
const clearance = 0.045;
const home = { x: 0, y: 1, fork: 0, belt: 0, cargoAt: 'belt' };
const steps = [
  ['Klar ved indløbet', 1.6, {}],
  ['Båndet fører holderen ind', 3.5, { belt: 1 }],
  ['Gaflen sænkes til transportbåndet', 2.25, { y: beltHeight - clearance }],
  ['Gaflen køres ind under holderen', 1.2, { fork: 1 }],
  ['Gaflen møder holderen', 0.4, { y: beltHeight }],
  ['Holderen løftes fri af båndet', 0.45, { y: beltHeight + clearance, cargoAt: 'fork' }],
  ['Holderen trækkes ind på vognen', 1.25, { fork: 0 }],
  ['Vognen kører til andet reolfag', 3.3, { x: bayX, y: bayHeight + clearance }],
  ['Holderen føres ind i reolen', 1.25, { fork: 1 }],
  ['Holderen sættes på plads', 0.55, { y: bayHeight }],
  ['Gaflen sænkes fri af holderen', 0.45, { y: bayHeight - clearance, cargoAt: 'slot' }],
  ['Gaflen trækkes ud af reolen', 1.2, { fork: 0 }],
  ['Vognen vender tilbage til reference', 2.8, { x: 0, y: 1 }],
  ['Holderen ligger på lager', 2.4, {}],
  ['Vognen kører til afhentning', 3.1, { x: bayX, y: bayHeight - clearance }],
  ['Gaflen føres ind under lagerpladsen', 1.2, { fork: 1 }],
  ['Gaflen møder holderen', 0.4, { y: bayHeight }],
  ['Holderen løftes fri af reolen', 0.5, { y: bayHeight + clearance, cargoAt: 'fork' }],
  ['Holderen trækkes ud af reolen', 1.2, { fork: 0 }],
  ['Vognen kører til transportbåndet', 3.3, { x: 0, y: beltHeight + clearance }],
  ['Holderen føres ind over båndet', 1.2, { fork: 1 }],
  ['Holderen sættes på båndet', 0.55, { y: beltHeight }],
  ['Gaflen sænkes fri af båndet', 0.45, { y: beltHeight - clearance, cargoAt: 'belt' }],
  ['Gaflen trækkes hjem', 1.2, { fork: 0 }],
  ['Holderen køres til udløbet', 3.5, { y: 1, belt: 0 }],
  ['Klar til næste indlagring', 1.5, {}],
];

let previous = home;
let time = 0;
const timeline = steps.map(([phase, duration, target]) => {
  const end = { ...previous, ...target };
  const step = { phase, duration, startTime: time, start: previous, end };
  previous = end;
  time += duration;
  return step;
});

export const cycleDuration = time;

// A slow, position-driven quadrature signal keeps the phase relationship visible
// during playback and leaves the channels at their last state when a motor stops.
function encoder(position, cycles) {
  const quarter = Math.floor(position * cycles * 4) % 4;
  return [quarter === 1 || quarter === 2, quarter === 2 || quarter === 3];
}

export function sampleSimulation(seconds = 0) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const elapsed = safeSeconds % cycleDuration;
  const step = timeline.find(stage => elapsed < stage.startTime + stage.duration) ?? timeline[0];
  const t = Math.min(1, Math.max(0, (elapsed - step.startTime) / step.duration));
  const blend = t * t * (3 - 2 * t);
  const { start, end } = step;
  const interpolate = key => start[key] + (end[key] - start[key]) * blend;
  const x = interpolate('x');
  const y = interpolate('y');
  const fork = interpolate('fork');
  const belt = interpolate('belt');
  const cargo = { at: end.cargoAt, column: 2, level: 1, beltPosition: belt };

  const onBelt = cargo.at === 'belt';
  const inTransfer = cargo.at === 'fork' && x === 0 && fork > 0.84 && y <= beltHeight + clearance;
  // In the demonstration, a light barrier is active while a carrier interrupts it.
  const innerBarrier = (onBelt && belt > 0.86) || inTransfer;
  const outerBarrier = onBelt && belt < 0.14;
  // A red workpiece carrier has one vertical dark stripe on its identification label.
  const darkStripe = onBelt && belt > 0.45 && belt < 0.55;
  const [B1, B2] = encoder(x, 12);
  const [B3, B4] = encoder(1 - y, 10);
  return {
    phase: step.phase,
    progress: elapsed / cycleDuration,
    elapsed,
    position: { x, y },
    pose: { x, y, fork, belt, cargo, slotOccupied: cargo.at === 'slot' },
    signals: {
      I1: x < 0.001, I2: innerBarrier, I3: outerBarrier, I4: y > 0.999,
      A1: darkStripe, A2: darkStripe, B1, B2, B3, B4,
      I5: fork > 0.999, I6: fork < 0.001,
      Q1: end.belt > start.belt, Q2: end.belt < start.belt,
      Q3: end.x > start.x, Q4: end.x < start.x,
      Q5: end.y < start.y, Q6: end.y > start.y,
      Q7: end.fork > start.fork, Q8: end.fork < start.fork,
    },
  };
}
