// Terminal numbers follow the 536631 circuit layout (page 2).
export const signals = [
  { id: 'I1', terminal: 5, group: 'input', label: 'Horizontal reference' },
  { id: 'I2', terminal: 6, group: 'input', label: 'Inner light barrier' },
  { id: 'I3', terminal: 7, group: 'input', label: 'Outer light barrier' },
  { id: 'I4', terminal: 8, group: 'input', label: 'Vertical reference' },
  { id: 'A1', terminal: 9, group: 'track', label: 'Lower track sensor' },
  { id: 'A2', terminal: 10, group: 'track', label: 'Upper track sensor' },
  { id: 'B1', terminal: 11, group: 'encoder', label: 'Horizontal encoder · track 1' },
  { id: 'B2', terminal: 12, group: 'encoder', label: 'Horizontal encoder · track 2' },
  { id: 'B3', terminal: 13, group: 'encoder', label: 'Vertical encoder · track 1' },
  { id: 'B4', terminal: 14, group: 'encoder', label: 'Vertical encoder · track 2' },
  { id: 'I5', terminal: 15, group: 'input', label: 'Fork fully extended' },
  { id: 'I6', terminal: 16, group: 'input', label: 'Fork retracted' },
  { id: 'Q1', terminal: 17, group: 'output', motor: 'M1', label: 'Conveyor forward' },
  { id: 'Q2', terminal: 18, group: 'output', motor: 'M1', label: 'Conveyor reverse' },
  { id: 'Q3', terminal: 19, group: 'output', motor: 'M2', label: 'Move toward rack' },
  { id: 'Q4', terminal: 20, group: 'output', motor: 'M2', label: 'Move toward conveyor' },
  { id: 'Q5', terminal: 21, group: 'output', motor: 'M3', label: 'Lower fork' },
  { id: 'Q6', terminal: 22, group: 'output', motor: 'M3', label: 'Raise fork' },
  { id: 'Q7', terminal: 23, group: 'output', motor: 'M4', label: 'Extend fork' },
  { id: 'Q8', terminal: 24, group: 'output', motor: 'M4', label: 'Retract fork' },
];

// X runs from the transfer station towards the farthest column. Y runs upwards.
// The fork must pass under each carrier, lift it clear, and lower it onto its support.
const beltHeight = 0.16;
const bayX = 2 / 3;
const bayHeight = 0.5;
const clearance = 0.045;
const home = { x: 0, y: 1, fork: 0, belt: 0, cargoAt: 'belt' };
const steps = [
  ['Ready at inlet', 1.6, {}],
  ['Conveyor feeds carrier in', 3.5, { belt: 1 }],
  ['Fork lowers to conveyor', 2.25, { y: beltHeight - clearance }],
  ['Fork slides under carrier', 1.2, { fork: 1 }],
  ['Fork makes contact with carrier', 0.4, { y: beltHeight }],
  ['Fork lifts carrier clear of conveyor', 0.45, { y: beltHeight + clearance, cargoAt: 'fork' }],
  ['Fork pulls carrier onto carriage', 1.25, { fork: 0 }],
  ['Carriage moves to the second bay', 3.3, { x: bayX, y: bayHeight + clearance }],
  ['Fork moves carrier into rack', 1.25, { fork: 1 }],
  ['Fork sets carrier down', 0.55, { y: bayHeight }],
  ['Fork lowers clear of carrier', 0.45, { y: bayHeight - clearance, cargoAt: 'slot' }],
  ['Fork retracts from rack', 1.2, { fork: 0 }],
  ['Carriage returns home', 2.8, { x: 0, y: 1 }],
  ['Carrier in storage', 2.4, {}],
  ['Carriage moves to pick-up position', 3.1, { x: bayX, y: bayHeight - clearance }],
  ['Fork slides under storage bay', 1.2, { fork: 1 }],
  ['Fork makes contact with carrier', 0.4, { y: bayHeight }],
  ['Fork lifts carrier clear of rack', 0.5, { y: bayHeight + clearance, cargoAt: 'fork' }],
  ['Fork pulls carrier out of rack', 1.2, { fork: 0 }],
  ['Carriage moves to conveyor', 3.3, { x: 0, y: beltHeight + clearance }],
  ['Fork positions carrier over conveyor', 1.2, { fork: 1 }],
  ['Fork sets carrier on conveyor', 0.55, { y: beltHeight }],
  ['Fork lowers clear of conveyor', 0.45, { y: beltHeight - clearance, cargoAt: 'belt' }],
  ['Fork retracts to home position', 1.2, { fork: 0 }],
  ['Conveyor moves carrier to outlet', 3.5, { y: 1, belt: 0 }],
  ['Ready for next storage cycle', 1.5, {}],
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
