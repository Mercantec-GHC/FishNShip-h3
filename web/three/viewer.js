import { createScene } from './scene.js';
import { cycleDuration, sampleSimulation } from './simulation.js';
import { mountSignalPanel } from './panel.js';

const $ = selector => document.querySelector(selector);
let source = 'demo';
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0;
let previous = null;
let nextReadout = 0;
let poseChanged = true;
let scene, panel;
try {
  scene = createScene({
    selectSignal: id => panel.selectModelSignal(id),
    editWiring: id => panel.editWiring(id),
  });
  $('#render-message').hidden = true;
} catch (error) {
  console.error('3D-modellen kunne ikke åbnes', error);
  $('#render-message').textContent = '3D-modellen kræver WebGL 2. Slå hardwareacceleration til i browseren, og genindlæs siden.';
  for (const element of document.querySelectorAll('.stage-tools button, .stage-tools select, .zoom-tools button')) element.disabled = true;
}
panel = mountSignalPanel({
  onSourceChange(next) {
    source = next;
    previous = null;
    nextReadout = 0;
    poseChanged = true;
  },
  onSelectSignal: selection => scene?.showSignal(selection),
  onDigitalState: state => scene?.setDigitalState(state),
});
const play = $('#play'), seek = $('#seek'), clock = $('#clock'), operation = $('#operation');
function updateButton() {
  play.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  const label = playing ? 'Sæt demo på pause' : 'Afspil demo';
  play.setAttribute('aria-label', label);
  play.title = label;
}
function updateReadout(sample) {
  const value = Math.round(sample.progress * 1000);
  const seconds = '00:' + String(Math.floor(sample.elapsed)).padStart(2, '0');
  if (operation.textContent !== sample.phase) operation.textContent = sample.phase;
  if (seek.valueAsNumber !== value) seek.value = value;
  if (clock.textContent !== seconds) clock.textContent = seconds;
  seek.setAttribute('aria-valuetext', seconds + ', ' + sample.phase);
  panel.updateDemo(sample, playing);
}
updateButton();
play.addEventListener('click', () => {
  playing = !playing;
  previous = null;
  nextReadout = 0;
  updateButton();
});
seek.addEventListener('input', () => {
  elapsed = Math.min(cycleDuration - .001, seek.valueAsNumber / 1000 * cycleDuration);
  poseChanged = true;
  previous = null;
  updateReadout(sampleSimulation(elapsed));
});
const helpButton = $('#show-help');
helpButton.addEventListener('click', () => {
  const opening = $('#help').hidden;
  $('#help').hidden = !opening;
  helpButton.setAttribute('aria-expanded', String(opening));
});
const full = $('#fullscreen');
if (document.fullscreenEnabled) {
  full.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('#stage').requestFullscreen();
    } catch { /* Browser policy can reject fullscreen in embedded views. */ }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? 'Afslut fuld skærm' : 'Fuld skærm';
    full.setAttribute('aria-label', label);
    full.title = label;
  });
} else full.hidden = true;
document.addEventListener('visibilitychange', () => { previous = null; });
function frame(now) {
  const delta = previous === null ? 0 : Math.max(0, (now - previous) / 1000);
  previous = now;
  if (source === 'demo') {
    if (playing) elapsed = (elapsed + delta) % cycleDuration;
    const sample = sampleSimulation(elapsed);
    scene?.render(playing || poseChanged ? sample.pose : null);
    if (now >= nextReadout || poseChanged) {
      updateReadout(sample);
      nextReadout = now + 65;
    }
  } else {
    scene?.render(poseChanged ? sampleSimulation(0).pose : null);
  }
  poseChanged = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
