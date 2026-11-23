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
const voltage = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const windowSeconds = 5;
const windowWidth = 280;

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

export function mountSignalPanel({ onSourceChange } = {}) {
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

  function chooseChannel(id) {
    selected[source][activeTab[source]] = id;
    for (const row of rows.values()) row.button.setAttribute('aria-pressed', String(row.channel.id === id));
    renderTrace();
  }

  function rebuildRows() {
    const group = activeTab[source];
    const channels = (source === 'demo' ? demoGroups : portentaGroups)[group];
    rows.clear();
    const fragment = document.createDocumentFragment();
    for (const channel of channels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-row';
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
      button.addEventListener('click', () => chooseChannel(channel.id));
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
    chooseChannel(selected[source][group]);
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
    rebuildRows();
    renderStatus();
    onSourceChange?.(source);
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
  });
  renderStatus();

  return {
    updateDemo(sample, isPlaying) {
      demo = sample;
      const playbackChanged = playing !== isPlaying;
      playing = isPlaying;
      if (source !== 'demo') return;
      if (playbackChanged) renderStatus();
      renderRows();
      if (lastPlotTime === null || Math.abs(demo.elapsed - lastPlotTime) >= 0.065 || playbackChanged ||
        (!playing && demo.elapsed !== lastPlotTime)) renderTrace();
    },
  };
}
