import * as THREE from 'three';
import { signals } from './simulation.js';

const descriptions = {
  'reference-x': 'The switch establishes the horizontal home position at the conveyor.',
  'reference-y': 'The switch at the top of the mast establishes the vertical home position.',
  'inner-gate': 'The inner light barrier detects the carrier at the transfer point between the conveyor and the fork.',
  'outer-gate': 'The outer light barrier detects the carrier at the outer end of the conveyor.',
  'reader-lower': 'The lower sensor reads the lower track of the carrier code.',
  'reader-upper': 'The upper sensor reads the upper track of the carrier code.',
  'fork-out': 'The limit switch detects when the telescopic fork is fully extended.',
  'fork-in': 'The limit switch detects when the telescopic fork is retracted.',
  'drive-x': 'The motor moves the mast along the rack. Two encoder tracks measure its movement.',
  'drive-y': 'The motor raises and lowers the carriage. Two encoder tracks measure its movement.',
  'belt-motor': 'The motor drives the conveyor in either direction between the inlet and the fork.',
  'fork-motor': 'The motor extends and retracts the telescopic fork.',
  rack: 'Nine storage bays support the carriers on red arms across three levels.',
  belt: 'The conveyor moves a carrier between the inlet and the lift carriage.',
  mast: 'The mast guides the carriage vertically in front of the storage bays.',
  carriage: 'The carriage supports the fork and travels vertically along the mast.',
  rail: 'The spindle moves the mast horizontally along the guide rails.',
  fork: 'The fork slides under the carrier at the conveyor and at the storage bay.',
  carrier: 'The fork moves the carrier and its red workpiece between the conveyor and the rack.',
  io: 'The terminals connect the power supply, sensor signals and motor outputs.',
  base: 'The baseplate supports the rack, guide rails, conveyor and I/O board.',
};
const digitalIds = Array.from({ length: 8 }, (_, i) => 'DI' + i);
const sensorIds = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'];
const isBarrier = id => id === 'inner-gate' || id === 'outer-gate';
const nameLabels = new Set(['rack', 'mast', 'belt', 'io']);
const bySignal = new Map(signals.map(signal => [signal.id, signal]));
const q = id => document.getElementById(id);
function levelName(value) {
  return value === 1 ? 'High (1)' : value === 0 ? 'Low (0)' : 'No reading';
}
function svgElement(type, style) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', type);
  element.classList.add(style);
  q('part-leaders').append(element);
  return element;
}

export function mountInspection({ warehouse, canvas, camera, invalidate, focusPart, selectSignal, editWiring }) {
  const stage = q('stage'), picker = q('part-picker'), info = q('part-info');
  const parts = new Map(warehouse.parts.map(part => [part.id, part]));
  const projected = new THREE.Vector3();
  let state = { source: 'demo', levels: {}, mapping: {}, activeLevels: {} };
  let activeParts = new Map();
  const pulseStarts = new Map(), recentPulses = new Map();
  let selectedChannel = null, selectedPart = null, namesVisible = false;
  let currentLabels = [];
  let detailSignalKey = null;
  const labels = new Map(), highlights = new Map(), chips = new Map();

  function inspectPart(id) {
    const part = parts.get(id);
    if (!part) return;
    // If the same drive exposes two encoder tracks, keep the one under inspection.
    if (currentPartId() === id && selectedChannel && selectSignal(selectedChannel)) return;
    for (const code of part.signals) if (selectSignal(code)) return;
    selectedChannel = null;
    selectedPart = id;
    refresh();
  }
  const groups = ['Machine parts', 'Sensors and motors'].map(label => {
    const group = document.createElement('optgroup');
    group.label = label;
    picker.append(group);
    return group;
  });
  for (const part of warehouse.parts) {
    groups[part.signals.length ? 1 : 0].append(new Option(part.name, part.id));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'part-tag';
    button.dataset.part = part.id;
    const caption = document.createElement('span');
    const status = document.createElement('small');
    status.className = 'activation-state';
    status.hidden = true;
    button.append(caption, status);
    button.hidden = true;
    button.addEventListener('click', () => inspectPart(part.id));
    q('annotations').append(button);
    const line = svgElement('line', 'part-leader'), halo = svgElement('circle', 'sensor-halo'), dot = svgElement('circle', 'part-point');
    halo.setAttribute('r', '14');
    halo.toggleAttribute('data-barrier', isBarrier(part.id));
    dot.setAttribute('r', '3');
    line.style.display = dot.style.display = halo.style.display = 'none';
    labels.set(part.id, { part, button, caption, status, line, dot, halo });
  }
  for (const id of digitalIds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'di-chip';
    button.textContent = id;
    button.dataset.channel = id;
    button.addEventListener('click', () => selectSignal(id));
    q('stage-inputs').append(button);
    chips.set(id, button);
  }

  function currentPartId() {
    if (!selectedChannel) return selectedPart;
    const pdfId = state.source === 'usb' ? state.mapping[selectedChannel] : selectedChannel;
    return warehouse.partBySignal[pdfId] || null;
  }
  function updateDetails(part) {
    const id = selectedChannel;
    info.hidden = !part && !id;
    const motor = bySignal.get(part?.signals.find(code => bySignal.get(code)?.motor))?.motor ||
      ({ belt: 'M1', rail: 'M2', mast: 'M3', carriage: 'M3', fork: 'M4' })[part?.id];
    const controls = q('part-motor');
    controls.hidden = state.source !== 'usb' || !motor;
    for (const button of controls.children) button.hidden = Boolean(button.dataset.motor && button.dataset.motor !== motor);
    if (info.hidden) return;
    q('part-name').textContent = part?.name || 'Portenta ' + id;
    q('part-description').textContent = part ? descriptions[part.id] :
      digitalIds.includes(id) ? 'Select the warehouse terminal for this input to see its signal on the connected part.' :
      'The signal monitor shows the voltage of the analog USB input.';
    const status = q('part-state');
    status.hidden = !id || (state.source === 'usb' && !digitalIds.includes(id));
    const level = state.levels[id];
    const sensorKnown = state.source === 'usb' && state.mapping[id] && level != null;
    const sensorOn = sensorKnown && level === state.activeLevels[id];
    let sensorText = '';
    if (sensorKnown) sensorText = isBarrier(part?.id) ? (sensorOn ? 'Beam interrupted' : 'Beam clear') : (sensorOn ? 'Active' : 'Inactive');
    status.textContent = id ? [id, levelName(level), sensorText].filter(Boolean).join(' · ') : '';
    status.toggleAttribute('data-linked', Boolean(sensorKnown));
    status.toggleAttribute('data-sensor-active', Boolean(sensorOn));
    status.dataset.level = level === 1 ? 'high' : level === 0 ? 'low' : 'unknown';
    q('focus-part').hidden = !part;
    q('map-part').hidden = state.source !== 'usb' || !digitalIds.includes(id);
    q('map-part').textContent = part ? 'Change mapping' : 'Map part';

    const signature = [part?.id, state.source, ...digitalIds.map(raw => state.mapping[raw])].join('|');
    if (signature === detailSignalKey) return;
    detailSignalKey = signature;
    const fragment = document.createDocumentFragment();
    for (const code of part?.signals ?? []) {
      const signal = bySignal.get(code);
      const rawIds = digitalIds.filter(raw => state.mapping[raw] === code);
      const visibleIds = state.source === 'usb' ? rawIds : [code];
      const legend = code + ' · terminal ' + signal.terminal;
      if (!visibleIds.length) {
        const span = document.createElement('span');
        span.textContent = legend;
        fragment.append(span);
      }
      for (const visibleId of visibleIds) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = (state.source === 'usb' ? visibleId + ' → ' : '') + legend;
        b.title = 'Show signal trace for ' + visibleId;
        b.addEventListener('click', () => selectSignal(visibleId));
        fragment.append(b);
      }
    }
    q('part-signals').replaceChildren(fragment);
  }

  function refresh() {
    const usb = state.source === 'usb';
    const currentId = currentPartId();
    stage.dataset.mode = state.source;
    q('live-strip').hidden = !usb;
    picker.value = currentId || '';
    updateDetails(parts.get(currentId));
    if (usb) {
      let high = 0, measured = false;
      const activeSensors = new Set();
      for (const [id, button] of chips) {
        const level = state.levels[id];
        const signal = state.mapping[id], partId = warehouse.partBySignal[signal];
        measured ||= level === 0 || level === 1;
        if (level === 1) high++;
        const sensorOn = Boolean(partId && activeParts.get(partId)?.includes(id));
        if (sensorOn) activeSensors.add(partId);
        button.toggleAttribute('data-linked', Boolean(partId));
        button.toggleAttribute('data-sensor-active', sensorOn);
        button.dataset.level = level === 1 ? 'high' : level === 0 ? 'low' : 'unknown';
        button.setAttribute('aria-pressed', String(id === selectedChannel));
        const hint = id + ' · ' + levelName(level) + (signal ? ' · ' + signal + ' · ' + parts.get(partId).name : ' · Unmapped') + (sensorOn ? ' · Active' : '');
        button.title = hint;
        button.setAttribute('aria-label', hint);
      }
      const count = digitalIds.some(id => state.mapping[id]) ? activeSensors.size + ' active' : high + ' high';
      q('digital-count').textContent = measured ? count : 'No reading';
    }
    currentLabels = [];
    for (const [id, item] of labels) {
      const currents = activeParts.get(id);
      const recent = recentPulses.get(id);
      const selected = id === currentId;
      const color = currents ? 0x00db81 : selected ? 0x398dff : null;
      if ((highlights.get(id) ?? null) !== color) {
        warehouse.setPartHighlight(id, color);
        if (isBarrier(id)) warehouse.setBarrierActive(id, Boolean(currents));
        highlights.set(id, color);
      }
      const visible = selected || currents || recent || (namesVisible && nameLabels.has(id));
      if (!visible) {
        item.button.hidden = true;
        item.line.style.display = item.dot.style.display = item.halo.style.display = 'none';
        delete item.halo.dataset.state;
        delete item.button.dataset.state;
        continue;
      }
      const mode = currents ? 'active' : recent ? 'recent' : selected ? 'selected' : 'name';
      item.button.dataset.state = item.dot.dataset.state = item.line.dataset.state = item.halo.dataset.state = mode;
      item.button.toggleAttribute('data-selected', selected);
      const channels = currents || recent?.channels;
      const code = channels ? [...new Set(channels.map(raw => usb ? (state.mapping[raw] ?? raw) : raw))].join(' + ') : selected ? selectedChannel : null;
      const text = (code ? code + ' · ' : '') + item.part.name;
      if (item.caption.textContent !== text) item.caption.textContent = text;
      const action = currents && bySignal.get(currents[0])?.motor ? bySignal.get(currents[0]).label : currents ? (isBarrier(id) ? 'Beam interrupted' : 'Active') : recent ? 'Recently active' : '';
      item.status.hidden = !action;
      if (item.status.textContent !== action) item.status.textContent = action;
      item.button.title = [text, action, usb ? channels?.join(' + ') : ''].filter(Boolean).join(' · ');
      item.button.setAttribute('aria-label', item.button.title);
      item.button.dataset.code = code || '';
      currentLabels.push(item);
    }
    invalidate();
  }
  function forgetPulse(id) {
    clearTimeout(recentPulses.get(id)?.timer);
    recentPulses.delete(id);
  }
  function setDigitalState(next) {
    const differentSource = state.source !== next.source;
    if (differentSource) { selectedChannel = selectedPart = null; }
    const usb = next.source === 'usb';
    const active = new Map();
    for (const channel of usb ? digitalIds : sensorIds) {
      const signal = usb ? next.mapping[channel] : channel;
      const partId = warehouse.partBySignal[signal];
      if (!partId || next.levels[channel] !== (usb ? next.activeLevels[channel] : 1)) continue;
      if (!active.has(partId)) active.set(partId, []);
      active.get(partId).push(channel);
    }

    if (usb) for (const signal of signals) {
      if (signal.motor && next.levels[signal.id] === 1) active.set(warehouse.partBySignal[signal.id], [signal.id]);
    }

    // A brief measured USB pulse can start and end before the next paint.
    // Extinguish the live light immediately; keep a separately labelled trace.
    const reset = differentSource || !usb || !digitalIds.some(id => next.levels[id] != null) ||
      digitalIds.some(id => next.mapping[id] !== state.mapping[id] || next.activeLevels[id] !== state.activeLevels[id]);
    if (reset) {
      pulseStarts.clear();
      for (const id of recentPulses.keys()) forgetPulse(id);
    } else {
      const now = performance.now();
      for (const signal of sensorIds) {
        const id = warehouse.partBySignal[signal];
        const channels = active.get(id), before = activeParts.get(id);
        if (channels && !before) {
          forgetPulse(id);
          if (channels.some(raw => state.levels[raw] != null)) pulseStarts.set(id, now);
        } else if (before && !channels) {
          const started = pulseStarts.get(id);
          if (started !== undefined && now - started <= 900) {
            recentPulses.set(id, { channels: before, timer: setTimeout(() => {
              recentPulses.delete(id);
              refresh();
            }, 1200) });
          }
          pulseStarts.delete(id);
        }
      }
    }
    state = next;
    activeParts = active;
    refresh();
  }
  function showSignal({ source, id, intent }) {
    if (intent === 'sync' || source !== state.source) return;
    selectedChannel = id;
    selectedPart = null;
    refresh();
    const part = parts.get(currentPartId());
    if (part) {
      part.anchor.getWorldPosition(projected).project(camera);
      if (Math.abs(projected.x) > .94 || Math.abs(projected.y) > .88 || Math.abs(projected.z) > 1) focusPart(part);
    }
    if (intent === 'user' && stage.getBoundingClientRect().bottom < window.innerHeight * .42) {
      stage.scrollIntoView({ block: 'start' });
    }
  }
  picker.addEventListener('change', () => picker.value ? inspectPart(picker.value) : close());
  q('map-part').addEventListener('click', () => {
    const id = selectedChannel;
    if (editWiring(id)) q('wiring-' + id).scrollIntoView({ block: 'nearest' });
  });
  q('focus-part').addEventListener('click', () => {
    const part = parts.get(currentPartId());
    if (part) focusPart(part);
  });
  function close() {
    selectedPart = selectedChannel = null;
    refresh();
  }
  q('close-part').addEventListener('click', () => { close(); picker.focus({ preventScroll: true }); });
  const markers = q('markers');
  markers.addEventListener('click', () => {
    namesVisible = !namesVisible;
    markers.setAttribute('aria-pressed', String(namesVisible));
    markers.title = namesVisible ? 'Hide part names' : 'Show part names';
    refresh();
  });

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const pointers = new Set();
  let tap = null;
  canvas.addEventListener('pointerdown', event => {
    pointers.add(event.pointerId);
    tap = pointers.size === 1 && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
  });
  canvas.addEventListener('pointermove', event => {
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5) tap = null;
  });
  for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    pointers.delete(event.pointerId);
    if (tap?.id === event.pointerId) tap = null;
  });
  canvas.addEventListener('pointerup', event => {
    pointers.delete(event.pointerId);
    if (tap?.id !== event.pointerId) return;
    tap = null;
    const rect = canvas.getBoundingClientRect();
    mouse.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height);
    ray.setFromCamera(mouse, camera);
    const hit = warehouse.pickPart(ray);
    if (hit) inspectPart(hit);
  });

  function projectLabels() {
    if (!currentLabels.length) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    q('annotations').toggleAttribute('data-compact', w < 500 && currentLabels.length >= 4);
    const placed = [];
    const tools = stage.querySelector('.stage-tools'), footer = stage.querySelector('.stage-bottom');
    const topLimit = tools.offsetTop + tools.offsetHeight + 5;
    const bottomLimit = footer.offsetTop - 5;
    for (const { part, button, line, dot, halo } of currentLabels) {
      part.anchor.getWorldPosition(projected).project(camera);
      const x = (projected.x + 1) * w / 2, y = (1 - projected.y) * h / 2;
      const off = Math.abs(projected.z) > 1 || x < 0 || x > w || y < 0 || y > h;
      button.hidden = off;
      line.style.display = dot.style.display = off ? 'none' : '';
      halo.style.display = !off && ['active','recent'].includes(button.dataset.state) ? '' : 'none';
      if (off) continue;
      const width = button.offsetWidth, height = button.offsetHeight;
      const columns = [x + 13, x - width - 13].map(raw => THREE.MathUtils.clamp(raw, 3, w - width - 3));
      if (x + width + 16 > w) columns.reverse();
      columns.push(3, w - width - 3);
      const preferredY = THREE.MathUtils.clamp(y - height - 10, topLimit, bottomLimit - height);
      let left = columns[0], top = preferredY, found = false;
      // Try both sides of the pointer, then neighbouring rows. Reserve the toolbars
      // even when a high sensor sits directly behind a camera button on mobile.
      for (let row = 0; row <= placed.length + 1 && !found; row++) {
        const shift = row * (height + 4);
        for (const candidateY of [preferredY - shift, preferredY + shift]) {
          if (candidateY < topLimit || candidateY + height > bottomLimit) continue;
          for (const candidateX of columns) {
            if (placed.some(p => candidateX < p.right + 3 && candidateX + width > p.left - 3 &&
                candidateY < p.bottom + 3 && candidateY + height > p.top - 3)) continue;
            left = candidateX; top = candidateY; found = true;
            break;
          }
          if (found) break;
        }
      }
      placed.push({ left, right: left + width, top, bottom: top + height });
      button.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
      line.setAttribute('x1', x); line.setAttribute('y1', y);
      line.setAttribute('x2', Math.min(left + width, Math.max(left, x))); line.setAttribute('y2', top + height / 2);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      halo.setAttribute('cx', x); halo.setAttribute('cy', y);
    }
  }
  return { showSignal, setDigitalState, projectLabels };
}
