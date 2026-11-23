import { createSignalMonitor } from '/signal-monitor.js';
import { sampleSimulation, signals } from './simulation.js';

const demoGroups = {
  inputs: signals.filter(signal => signal.group !== 'output'),
  outputs: signals.filter(signal => signal.group === 'output'),
};
const portentaGroups = {
  inputs: Array.from({ length: 8 }, (_, index) => ({ id: `DI${index}`, index, label: 'Digital indgang' })),
  outputs: Array.from({ length: 3 }, (_, index) => ({ id: `AI${index}`, index, label: 'Analog indgang', analog: true })),
};
const pdfInputs = new Map(demoGroups.inputs.map(channel => [channel.id, channel]));
const wiringKey = 'fishnship.536631.wiring.v1.';
const voltage = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const windowSeconds = 5;
const windowWidth = 280;

function readWiring() {
  const mapping = {};
  for (const { id } of portentaGroups.inputs) {
    let stored = null;
    try { stored = localStorage.getItem(wiringKey + id); } catch { /* Storage may be disabled. */ }
    mapping[id] = pdfInputs.has(stored) ? stored : null;
  }
  return Object.freeze(mapping);
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

export function mountSignalPanel({ onSourceChange, onSelectSignal, onDigitalState } = {}) {
  const find = id => document.getElementById(id);
  const sources = [...document.querySelectorAll('[data-source]')];
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const list = find('channel-list');
  const trace = find('trace');
  const plot = find('scope-plot');
  const scopeLabel = find('scope-label');
  const usbMessage = find('usb-message');
  const statusLamp = find('status-lamp');
  const status = find('monitor-status');
  const connect = find('connect');
  const reconnect = find('reconnect');
  const disconnect = find('disconnect');
  const wiringTools = find('wiring-tools');
  const toggleWiring = find('toggle-wiring');
  const wiringEditor = find('wiring-editor');
  const wiringStatus = find('wiring-status');
  const wiringSelects = new Map();
  const monitor = createSignalMonitor();
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
  let mapping = readWiring();
  let emittedKey = '';
  let emittedMapping;

  function emitLevels() {
    if (!onDigitalState) return;
    const levels = {};
    if (source === 'demo') {
      for (const { id } of signals) levels[id] = Number(demo.signals[id]);
    } else {
      for (const { id, index } of portentaGroups.inputs) levels[id] = usb.frame?.digital[index] ?? null;
    }
    const key = source + Object.values(levels).map(value => value ?? '-').join('');
    if (key === emittedKey && mapping === emittedMapping) return;
    emittedKey = key;
    emittedMapping = mapping;
    onDigitalState({ source, levels, mapping });
  }

  function emitSelection(intent) {
    const id = selected[source][activeTab[source]];
    onSelectSignal?.({ source, id, mappedSignal: source === 'demo' ? id : mapping[id] ?? null, intent });
  }

  function openWiring(open) {
    wiringEditor.hidden = !open;
    toggleWiring.setAttribute('aria-expanded', String(open));
    setText(toggleWiring, open ? 'Luk tilknytning' : 'Tilknyt indgange');
  }

  function applyWiring(next, announce = '') {
    mapping = Object.freeze(next);
    for (const [id, select] of wiringSelects) select.value = mapping[id] ?? '';
    setText(wiringStatus, announce);
    if (source !== 'usb') return;
    renderRows();
    emitLevels();
    emitSelection('sync');
  }

  for (const { id } of portentaGroups.inputs) {
    const label = document.createElement('label');
    label.className = 'wiring-field';
    const name = document.createElement('span');
    name.textContent = id;
    const select = document.createElement('select');
    select.id = 'wiring-' + id;
    select.setAttribute('aria-label', `Klemme til ${id}`);
    select.add(new Option('Ikke tilknyttet', ''));
    for (const input of pdfInputs.values()) {
      select.add(new Option(`${input.id} · ${input.label} · kl. ${input.terminal}`, input.id));
    }
    select.value = mapping[id] ?? '';
    select.addEventListener('change', () => {
      const next = select.value || null;
      let message = next ? `${id} er knyttet til ${next}.` : `Tilknytningen for ${id} er fjernet.`;
      try {
        if (next) localStorage.setItem(wiringKey + id, next);
        else localStorage.removeItem(wiringKey + id);
      } catch {
        message += ' Browseren kunne kun gemme ændringen for denne visning.';
      }
      applyWiring({ ...mapping, [id]: next }, message);
    });
    label.append(name, select);
    find('wiring-fields').append(label);
    wiringSelects.set(id, select);
  }
  toggleWiring.addEventListener('click', () => openWiring(wiringEditor.hidden));
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(wiringKey)) applyWiring(readWiring());
  });

  function renderTrace() {
    const id = selected[source][activeTab[source]];
    const channel = rows.get(id).channel;
    setText(scopeLabel, `${id} · 5 s`);
    const description = channel.analog ? 'Skala 0 til 10 volt.' : 'Nederst er 0, øverst er 1.';
    plot.setAttribute('aria-label', `${id}, de seneste fem sekunder frem til nu. ${description}`);
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
    for (const { channel, button, name, reading } of rows.values()) {
      const live = source === 'usb';
      const value = live ? usbValue(usb.frame, channel) : Number(demo.signals[channel.id]);
      let label = channel.label;
      let display = value === null ? '—' : String(value);
      let missing = value === null;
      if (live && !channel.analog) {
        const linked = pdfInputs.get(mapping[channel.id]);
        label = linked ? `${linked.id} · ${linked.label}` : 'Ikke tilknyttet';
        button.title = linked ? `${linked.id} · Klemme ${linked.terminal}` : 'Portenta-indgang uden tilknyttet klemme';
      }
      if (channel.analog) {
        const volts = usb.frame?.analog[channel.index];
        const raw = usb.frame?.adc[channel.index];
        const state = voltageStatus(volts, raw);
        if (raw !== undefined) label = `ADC ${raw} / 65535`;
        if (state === 'valid') display = `${voltage.format(volts)} V`;
        if (state === 'saturated') display = 'Mættet';
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
      const reading = document.createElement('span');
      reading.className = 'channel-reading';
      value.append(led, reading);
      button.append(code, name, value);
      if (channel.terminal) button.title = `Klemme ${channel.terminal}${channel.motor ? ' · ' + channel.motor : ''}`;
      button.addEventListener('click', () => chooseChannel(channel.id, 'user'));
      fragment.append(button);
      rows.set(channel.id, { button, name, reading, channel });
    }
    list.replaceChildren(fragment);
    list.scrollTop = 0;
    for (const tab of tabs) {
      const first = tab.dataset.tab === 'inputs';
      setText(tab, source === 'demo' ? (first ? 'Indgange' : 'Udgange') : (first ? 'Digitale' : 'Analoge'));
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
      setText(status, playing ? 'Simulerede signaler' : 'Demo på pause');
      return;
    }
    statusLamp.dataset.mode = usb.phase === 'live' ? 'live' : 'idle';
    setText(status, usb.phase === 'live' ? 'Målinger fra Portenta' : 'Ingen aktuelle målinger');
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
    find('transport').hidden = live;
    find('hardware-caption').hidden = !live;
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
  rebuildRows();
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
      const select = wiringSelects.get(id);
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
