import markup from './panel.html';
import { createSignalMonitor } from '/signal-monitor.js';
import { sampleSimulation, signals } from './simulation.js';

const demoGroups = {
  inputs: signals.filter(signal => signal.group !== 'output'),
  outputs: signals.filter(signal => signal.group === 'output'),
};
const portentaGroups = {
  inputs: Array.from({ length: 8 }, (_, index) => ({ id: `DI${index}`, index, label: 'Digital input' })),
  outputs: Array.from({ length: 3 }, (_, index) => ({ id: `AI${index}`, index, label: 'Analog input', analog: true })),
};
const pdfInputs = new Map(demoGroups.inputs.map(channel => [channel.id, channel]));
const wiringKey = 'fishnship.536631.wiring.v1.';
const polarityKey = 'fishnship.536631.polarity.v1.';
const voltage = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const windowSeconds = 5;
const windowWidth = 280;

function loadSetting(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function activeLevelFor(id, signal) {
  if (!signal) return 1;
  const stored = loadSetting(polarityKey + id + '.' + signal);
  if (stored === '0' || stored === '1') return Number(stored);
  // In the 536631 circuit, breaking a light beam cuts phototransistor current.
  return signal === 'I2' || signal === 'I3' ? 0 : 1;
}

function readWiring() {
  const mapping = {};
  const activeLevels = {};
  for (const { id } of portentaGroups.inputs) {
    const stored = loadSetting(wiringKey + id);
    mapping[id] = pdfInputs.has(stored) ? stored : null;
    activeLevels[id] = activeLevelFor(id, mapping[id]);
  }
  return { mapping: Object.freeze(mapping), activeLevels: Object.freeze(activeLevels) };
}

// Reveal a model-selected row inside the monitor without moving the page or camera.
function revealIn(container, element) {
  const parent = container.getBoundingClientRect();
  const child = element.getBoundingClientRect();
  if (child.top < parent.top) container.scrollTop += child.top - parent.top;
  else if (child.bottom > parent.bottom) container.scrollTop += child.bottom - parent.bottom;
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function voltageStatus(value, raw) {
  if (!Number.isFinite(value)) return 'missing';
  if (raw === 65535 || (raw === undefined && value >= 10.692)) return 'saturated';
  return value > 10 ? 'overrange' : 'valid';
}

function usbValue(frame, channel) {
  if (!channel.analog) return frame?.digital[channel.index] ?? null;
  const value = frame?.analog[channel.index];
  return voltageStatus(value, frame?.adc[channel.index]) === 'valid' ? value : null;
}

function demoTrace(id, elapsed, current) {
  // Reconstruct the selected window in simulation time. Seeking and pausing therefore
  // show the actual levels at that position, without a line through the seek.
  const left = elapsed - windowSeconds;
  const first = Math.max(0, left);
  const toX = time => ((time - left) * windowWidth / windowSeconds).toFixed(2);
  const toY = level => level ? 9 : 41;
  let previous = sampleSimulation(first).signals[id];
  let path = `M${toX(first)} ${toY(previous)}`;
  const count = Math.ceil((elapsed - first) * 40);
  for (let i = 1; i <= count; i++) {
    const time = first + (elapsed - first) * i / count;
    const level = i === count ? current : sampleSimulation(time).signals[id];
    if (level !== previous) path += `H${toX(time)}V${toY(level)}`;
    previous = level;
  }
  return path + `H${windowWidth}`;
}

function usbTrace(history, channel, now) {
  const left = now - windowSeconds * 1000;
  let previousTime = null;
  let path = '';
  for (const frame of history) {
    const value = usbValue(frame, channel);
    if (value === null) {
      previousTime = null;
      continue;
    }
    const x = ((frame.timestamp - left) * windowWidth / (windowSeconds * 1000)).toFixed(2);
    const y = (41 - 32 * value / (channel.analog ? 10 : 1)).toFixed(2);
    // The sketch sends a frame every 200 ms. Stop the trace across missing readings
    // and at the latest actual frame, leaving the unknown part of the window blank.
    if (previousTime === null || frame.timestamp - previousTime > 650) path += `M${x} ${y}h0.01`;
    else if (channel.analog) path += `L${x} ${y}`;
    else path += `H${x}V${y}`;
    previousTime = frame.timestamp;
  }
  return path;
}

export function mountSignalPanel({ onSourceChange, onSelectSignal, onDigitalState, monitor = createSignalMonitor(), usbOnly = false } = {}) {
  document.querySelector('.monitor').innerHTML = markup;
  const find = id => document.getElementById(id);
  const sources = [...document.querySelectorAll('[data-source]')];
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const list = find('channel-list');
  const trace = find('trace');
  const plot = find('scope-plot');
  const scopeLabel = find('scope-label');
  const usbMessage = find('usb-message');
  const statusLamp = find('status-lamp');
  const status = find('signal-panel-status');
  const connect = find('connect');
  const reconnect = find('reconnect');
  const disconnect = find('disconnect');
  const motorPicker = find('motor-picker');
  const motorButtons = [];
  for (const group of [find('motor-actions'), find('part-motor')].filter(Boolean)) {
    for (const output of [...demoGroups.outputs, { id: 'STOP', label: 'Stop all' }]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = true;
      button.dataset.command = output.id;
      if (output.motor) button.dataset.motor = output.motor;
      if (output.motor) {
        const code = document.createElement('b');
        code.textContent = output.id;
        button.append(code, document.createTextNode(output.label.replace(/^Conveyor /, '')));
        button.setAttribute('aria-label', output.id + ' · ' + output.label + ' for one second');
      } else button.textContent = output.label;
      button.addEventListener('click', async () => {
        try { await monitor.sendMotor(output.id); }
        catch { setText(usbMessage, 'Could not send the motor command. Check the USB connection.'); }
      });
      group.append(button);
      motorButtons.push(button);
    }
  }
  motorPicker.addEventListener('change', renderStatus);
  const wiringTools = find('wiring-tools');
  const toggleWiring = find('toggle-wiring');
  const wiringEditor = find('wiring-editor');
  const wiringStatus = find('wiring-status');
  const wiringSelects = new Map();

  const selected = { demo: { inputs: 'I1', outputs: 'Q1' }, usb: { inputs: 'DI0', outputs: 'AI0' } };
  const activeTab = { demo: 'inputs', usb: 'inputs' };
  const rows = new Map();
  let source = 'demo';
  let usb = monitor.state;
  let history = [];
  let previousFrame = null;
  let chartTimer;
  let demo = sampleSimulation(0);
  let playing = true;
  let lastPlotTime = null;
  let { mapping, activeLevels } = readWiring();
  let emittedKey = '';
  let emittedMapping;
  let emittedActiveLevels;

  function emitLevels() {
    if (!onDigitalState) return;
    const levels = {};
    if (source === 'demo') {
      for (const { id } of signals) levels[id] = Number(demo.signals[id]);
    } else {
      for (const [index, output] of demoGroups.outputs.entries()) levels[output.id] = usb.frame?.outputs?.[index] ?? null;
      for (const { id, index } of portentaGroups.inputs) levels[id] = usb.frame?.digital[index] ?? null;
    }
    const key = source + Object.values(levels).map(value => value ?? '-').join('');
    if (key === emittedKey && mapping === emittedMapping && activeLevels === emittedActiveLevels) return;
    emittedKey = key;
    emittedMapping = mapping;
    emittedActiveLevels = activeLevels;
    onDigitalState({ source, levels, mapping, activeLevels });
  }

  function emitSelection(intent) {
    const id = selected[source][activeTab[source]];
    onSelectSignal?.({ source, id, mappedSignal: source === 'demo' ? id : mapping[id] ?? null, intent });
  }

  function openWiring(open) {
    wiringEditor.hidden = !open;
    toggleWiring.setAttribute('aria-expanded', String(open));
    setText(toggleWiring, open ? 'Close input mapping' : 'Map inputs');
  }

  function applyWiring(next, announce = '') {
    mapping = Object.freeze(next.mapping);
    activeLevels = Object.freeze(next.activeLevels);
    for (const [id, controls] of wiringSelects) {
      controls.signal.value = mapping[id] ?? '';
      controls.active.value = String(activeLevels[id]);
      controls.active.disabled = !mapping[id];
    }
    setText(wiringStatus, announce);
    if (source !== 'usb') return;
    renderRows();
    emitLevels();
    emitSelection('sync');
  }

  for (const { id } of portentaGroups.inputs) {
    const field = document.createElement('div');
    field.className = 'wiring-field';
    const name = document.createElement('span');
    name.textContent = id;
    const select = document.createElement('select');
    select.id = 'wiring-' + id;
    select.setAttribute('aria-label', `Terminal for ${id}`);
    select.add(new Option('Unmapped', ''));
    for (const input of pdfInputs.values()) {
      select.add(new Option(`${input.id} · ${input.label} · terminal ${input.terminal}`, input.id));
    }
    select.value = mapping[id] ?? '';
    const active = document.createElement('select');
    active.id = 'wiring-active-' + id;
    active.className = 'wiring-polarity';
    active.setAttribute('aria-label', `Active level for ${id}`);
    active.add(new Option('Active at 0', '0'));
    active.add(new Option('Active at 1', '1'));
    active.value = String(activeLevels[id]);
    active.disabled = !mapping[id];
    select.addEventListener('change', () => {
      const next = select.value || null;
      const level = activeLevelFor(id, next);
      let message = next ? `${id} mapped to ${next}. The sensor is active at ${level}.` : `Mapping removed for ${id}.`;
      try {
        if (next) localStorage.setItem(wiringKey + id, next);
        else localStorage.removeItem(wiringKey + id);
      } catch {
        message += ' This change could only be saved for the current session.';
      }
      applyWiring({ mapping: { ...mapping, [id]: next }, activeLevels: { ...activeLevels, [id]: level } }, message);
    });
    active.addEventListener('change', () => {
      const signal = mapping[id];
      if (!signal) return;
      const level = Number(active.value);
      let message = `${signal} is active when ${id} is ${level}.`;
      try { localStorage.setItem(polarityKey + id + '.' + signal, String(level)); } catch {
        message += ' This change could only be saved for the current session.';
      }
      applyWiring({ mapping, activeLevels: { ...activeLevels, [id]: level } }, message);
    });
    field.append(name, select, active);
    find('wiring-fields').append(field);
    wiringSelects.set(id, { signal: select, active });
  }
  toggleWiring.addEventListener('click', () => openWiring(wiringEditor.hidden));
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(wiringKey) || event.key.startsWith(polarityKey)) applyWiring(readWiring());
  });

  function renderTrace() {
    const id = selected[source][activeTab[source]];
    const channel = rows.get(id).channel;
    setText(scopeLabel, `${id} · 5 s`);
    const description = channel.analog ? 'Range: 0 to 10 volts.' : 'The bottom is 0 and the top is 1.';
    plot.setAttribute('aria-label', `${id} over the last five seconds. ${description}`);
    if (source === 'demo') {
      trace.setAttribute('d', demoTrace(id, demo.elapsed, demo.signals[id]));
      lastPlotTime = demo.elapsed;
    } else {
      const now = Date.now();
      history = history.filter(frame => frame.timestamp > now - windowSeconds * 1000 - 650);
      trace.setAttribute('d', usbTrace(history, channel, now));
    }
  }

  function renderRows() {
    for (const { channel, button, name, reading, activeBadge } of rows.values()) {
      const live = source === 'usb';
      const value = live ? usbValue(usb.frame, channel) : Number(demo.signals[channel.id]);
      let label = channel.label;
      let display = value === null ? '—' : String(value);
      let missing = value === null;
      const isSensorActive = live && !channel.analog && Boolean(mapping[channel.id]) && value === activeLevels[channel.id];
      button.toggleAttribute('data-linked', live && !channel.analog && Boolean(mapping[channel.id]));
      button.toggleAttribute('data-sensor-active', isSensorActive);
      activeBadge.hidden = !isSensorActive;
      if (live && !channel.analog) {
        const linked = pdfInputs.get(mapping[channel.id]);
        label = linked ? `${linked.id} · ${linked.label}` : 'Unmapped';
        button.title = linked ? `${linked.id} · Terminal ${linked.terminal} · Active at ${activeLevels[channel.id]}` : 'Portenta input with no mapped terminal';
      }
      if (channel.analog) {
        const volts = usb.frame?.analog[channel.index];
        const raw = usb.frame?.adc[channel.index];
        const state = voltageStatus(volts, raw);
        if (raw !== undefined) label = `ADC ${raw} / 65535`;
        if (state === 'valid') display = `${voltage.format(volts)} V`;
        if (state === 'saturated') display = 'Saturated';
        if (state === 'overrange') display = '> 10 V';
        missing = state === 'missing';
      }
      button.toggleAttribute('data-high', !channel.analog && value === 1);
      button.toggleAttribute('data-unknown', missing);
      setText(name, label);
      setText(reading, display);
    }
  }

  function chooseChannel(id, intent) {
    selected[source][activeTab[source]] = id;
    for (const row of rows.values()) row.button.setAttribute('aria-pressed', String(row.channel.id === id));
    renderTrace();
    if (intent) emitSelection(intent);
  }

  function rebuildRows(intent = 'sync') {
    const group = activeTab[source];
    const channels = (source === 'demo' ? demoGroups : portentaGroups)[group];
    wiringTools.hidden = source !== 'usb' || group !== 'inputs';
    if (wiringTools.hidden) openWiring(false);
    rows.clear();
    const fragment = document.createDocumentFragment();
    for (const channel of channels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-row';
      button.dataset.channel = channel.id;
      const code = document.createElement('span');
      code.className = 'channel-code';
      code.textContent = channel.id;
      const name = document.createElement('span');
      name.className = 'channel-name';
      const value = document.createElement('span');
      value.className = 'channel-value';
      const led = document.createElement('span');
      led.className = 'channel-led';
      led.setAttribute('aria-hidden', 'true');
      const activeBadge = document.createElement('span');
      activeBadge.className = 'channel-active';
      activeBadge.textContent = 'Active';
      activeBadge.hidden = true;
      const reading = document.createElement('span');
      reading.className = 'channel-reading';
      value.append(activeBadge, led, reading);
      button.append(code, name, value);
      if (channel.terminal) button.title = `Terminal ${channel.terminal}${channel.motor ? ' · ' + channel.motor : ''}`;
      button.addEventListener('click', () => chooseChannel(channel.id, 'user'));
      fragment.append(button);
      rows.set(channel.id, { button, name, reading, activeBadge, channel });
    }
    list.replaceChildren(fragment);
    list.scrollTop = 0;
    for (const tab of tabs) {
      const first = tab.dataset.tab === 'inputs';
      setText(tab, source === 'demo' ? (first ? 'Inputs' : 'Outputs') : (first ? 'Digital' : 'Analog'));
      tab.setAttribute('aria-pressed', String(tab.dataset.tab === group));
    }
    renderRows();
    chooseChannel(selected[source][group], intent);
  }

  function selectModelSignal(id) {
    let channelId = id;
    if (source === 'usb' && pdfInputs.has(id)) {
      const current = selected.usb.inputs;
      channelId = mapping[current] === id ? current : portentaGroups.inputs.find(channel => mapping[channel.id] === id)?.id;
    }
    const groups = source === 'demo' ? demoGroups : portentaGroups;
    const group = Object.keys(groups).find(key => groups[key].some(channel => channel.id === channelId));
    if (!group) return false;
    if (activeTab[source] !== group) {
      activeTab[source] = group;
      selected[source][group] = channelId;
      rebuildRows('model');
    } else chooseChannel(channelId, 'model');
    revealIn(list, rows.get(channelId).button);
    return true;
  }

  function renderStatus() {
    if (source === 'demo') {
      statusLamp.dataset.mode = playing ? 'demo' : 'idle';
      setText(status, playing ? 'Simulated signals' : 'Demo paused');
      return;
    }
    statusLamp.dataset.mode = usb.phase === 'live' ? 'live' : 'idle';
    setText(status, usb.phase === 'live' ? 'Portenta readings' : 'No current readings');
    const outputs = usb.frame?.outputs;
    const active = demoGroups.outputs[outputs?.indexOf(1)];
    const upgrade = outputs?.length === 2 && motorPicker.value !== 'M1';
    const description = active ? active.id + ' · ' + active.label : outputs ? 'Stopped' : 'Waiting for USB output readings.';
    setText(find('motor-state'), (upgrade || (usb.frame && !outputs)) ? description + ' Upload the all-motor sketch to enable Q1–Q8.' : description);
    for (const button of motorButtons) {
      if (button.parentElement.id === 'motor-actions') button.hidden = Boolean(button.dataset.motor && button.dataset.motor !== motorPicker.value);
      const command = button.dataset.command;
      button.disabled = !outputs || (command !== 'STOP' && (Boolean(active) || Number(command.slice(1)) > outputs.length));
    }
    setText(usbMessage, usb.message);
    connect.hidden = !usb.canChoose;
    reconnect.hidden = !usb.canReconnect;
    disconnect.hidden = !usb.canDisconnect;
  }

  function changeSource(next) {
    if (source === next) return;
    source = next;
    const live = source === 'usb';
    find('usb-setup').hidden = !live;
    if (!usbOnly) find('transport').hidden = live;
    if (!usbOnly) find('hardware-caption').hidden = !live;
    for (const button of sources) button.setAttribute('aria-pressed', String(button.dataset.source === source));
    clearInterval(chartTimer);
    if (live) chartTimer = setInterval(renderTrace, 125);
    else void monitor.disconnect().catch(() => {});
    rebuildRows(null);
    renderStatus();
    onSourceChange?.(source);
    emitLevels();
    emitSelection('sync');
  }

  for (const button of sources) button.addEventListener('click', () => changeSource(button.dataset.source));
  for (const tab of tabs) tab.addEventListener('click', () => {
    activeTab[source] = tab.dataset.tab;
    rebuildRows();
  });
  connect.addEventListener('click', () => { void monitor.connect(); });
  reconnect.addEventListener('click', () => { void monitor.reconnect(); });
  disconnect.addEventListener('click', () => { void monitor.disconnect().catch(error => setText(usbMessage, error.message)); });
  if (usbOnly) {
    document.querySelector('.sources').hidden = true;
    changeSource('usb');
  } else rebuildRows();
  monitor.subscribe(state => {
    usb = state;
    if (state.phase === 'opening' || state.phase === 'waiting') history = [];
    if (state.frame && state.frame !== previousFrame) {
      history.push(state.frame);
      if (history.length > 300) history.shift();
    }
    previousFrame = state.frame;
    if (source !== 'usb') return;
    renderStatus();
    renderRows();
    renderTrace();
    emitLevels();
  });
  renderStatus();
  emitLevels();

  return {
    selectModelSignal,
    editWiring(id) {
      const select = wiringSelects.get(id)?.signal;
      if (!select) return false;
      if (source !== 'usb') changeSource('usb');
      selectModelSignal(id);
      openWiring(true);
      select.focus({ preventScroll: true });
      revealIn(wiringEditor, select);
      return true;
    },
    updateDemo(sample, isPlaying) {
      demo = sample;
      const playbackChanged = playing !== isPlaying;
      playing = isPlaying;
      if (source !== 'demo') return;
      if (playbackChanged) renderStatus();
      renderRows();
      emitLevels();
      if (lastPlotTime === null || Math.abs(demo.elapsed - lastPlotTime) >= 0.065 || playbackChanged ||
        (!playing && demo.elapsed !== lastPlotTime)) renderTrace();
    },
  };
}
