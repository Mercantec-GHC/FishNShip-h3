import { createSignalMonitor } from './signal-monitor.js';
const chooseButtons = document.querySelectorAll('[data-usb="choose"]');
const reconnectButtons = document.querySelectorAll('[data-usb="reconnect"]');
const disconnectButtons = document.querySelectorAll('[data-usb="disconnect"]');
const connectionStatus = document.querySelector('#connection-status');
const monitorStatus = document.querySelector('#monitor-status');
const inputSource = document.querySelector('#input-source');
const eventList = document.querySelector('#events');
const emptyEvents = document.querySelector('#events-empty');
const inputCount = document.querySelector('#input-count');
const analogRows = Array.from(document.querySelectorAll('#analog-inputs tr'), row => ({
  voltage: row.cells[1], raw: row.cells[2], status: row.cells[3], previous: null,
}));
const voltageFormat = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const lastChange = document.querySelector('#last-change');
const serialLog = document.querySelector('#serial-log');
const serialLines = [];
const inputRows = Array.from(document.querySelectorAll('#input-rows tr')).map(row => ({
  row,
  level: row.querySelector('.input-level'),
  highlightTimer: null,
}));

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium' });
let lastLevels = null;
let uploading = false;
let previousState;
const monitor = createSignalMonitor({ onLines: appendSerialLines });

function levelLabel(value) {
  return value === 1 ? 'High' : 'Low';
}

function addEvent(message) {
  const now = new Date();
  const event = document.createElement('li');
  const time = document.createElement('time');
  const description = document.createElement('span');
  time.dateTime = now.toISOString();
  time.textContent = timeFormat.format(now);
  description.textContent = message;
  event.append(time, description);
  emptyEvents.hidden = true;
  eventList.prepend(event);

  if (eventList.children.length > 6) {
    eventList.lastElementChild.remove();
  }
}

function setConnectionStatus(message, error = false) {
  for (const status of [connectionStatus, monitorStatus]) {
    if (status.textContent !== message) status.textContent = message;
    status.toggleAttribute('data-error', error);
  }
}

function showInputs(levels, voltages = [], counts = []) {
  analogRows.forEach((row, channel) => {
    const value = voltages[channel];
    const count = counts[channel];
    const hasReading = Number.isFinite(value);
    const hasRaw = Number.isInteger(count) && count >= 0 && count <= 65535;
    const saturated = count === 65535 || (!hasRaw && hasReading && value >= 10.692);
    const status = !hasReading ? 'No reading' : saturated ? 'Saturated' : value > 10 ? 'Over 10 V' : 'Within 0–10 V';
    row.voltage.textContent = hasReading && !saturated && value <= 10 ? voltageFormat.format(value) + ' V' : '–';
    row.raw.textContent = hasRaw ? String(count) : '–';
    if (row.status.textContent !== status) row.status.textContent = status;
    row.status.classList.toggle('measurement-warning', saturated || value > 10);
    if (hasReading && row.previous !== null && row.previous !== status) addEvent(`AI${channel}: ${status}`);
    row.previous = hasReading ? status : null;
  });
  const changes = [];
  inputRows.forEach((channelRow, channel) => {
    const { row, level } = channelRow;
    const value = levels?.[channel];
    const text = value === undefined ? 'No reading' : `${levelLabel(value)} (${value})`;
    if (level.textContent !== text) {
      level.textContent = text;
    }
    level.toggleAttribute('data-high', value === 1);
    if (levels && lastLevels && value !== lastLevels[channel]) {
      changes.push(`DI${channel}: ${levelLabel(lastLevels[channel])} → ${levelLabel(value)}`);
      row.setAttribute('data-changed', '');
      clearTimeout(channelRow.highlightTimer);
      channelRow.highlightTimer = setTimeout(() => row.removeAttribute('data-changed'), 2400);
    } else if (!lastLevels || !levels) {
      clearTimeout(channelRow.highlightTimer);
      row.removeAttribute('data-changed');
    }
  });
  lastLevels = levels;
  inputCount.textContent = levels ? `${levels.reduce((sum, value) => sum + value, 0)} of ${levels.length} high` : 'No readings';
  if (changes.length) {
    const message = changes.join(' / ');
    lastChange.textContent = `Latest transition: ${message}`;
    addEvent(message);
  }
}

function appendSerialLines(lines) {
  const follow = serialLog.scrollHeight - serialLog.scrollTop - serialLog.clientHeight < 24;
  for (const line of lines) {
    serialLines.push(line.trimEnd().slice(0, 1024));
    if (serialLines.length > 150) serialLines.shift();
  }
  serialLog.textContent = serialLines.join('\n');
  if (follow) serialLog.scrollTop = serialLog.scrollHeight;
}

function updateControls(state = monitor.state) {
  for (const button of chooseButtons) button.disabled = uploading || !state.canChoose;
  for (const button of reconnectButtons) button.disabled = uploading || !state.canReconnect;
  for (const button of disconnectButtons) button.disabled = uploading || !state.canDisconnect;
}

function renderMonitor(state) {
  updateControls(state);
  setConnectionStatus(state.message, state.phase === 'error');
  if (previousState?.phase !== state.phase || previousState.frame !== state.frame) {
    const frame = state.frame;
    showInputs(frame?.digital ?? null, frame?.analog, frame?.adc);
    if (frame) {
      inputSource.textContent = 'Live from Arduino via USB';
    } else if (state.phase === 'stale') {
      inputSource.textContent = 'No new readings from Arduino.';
    } else {
      inputSource.textContent = state.connected ? 'Waiting for Arduino readings…' : 'Connect the Arduino via USB to see signals.';
      lastChange.textContent = 'The latest transition will appear here.';
    }
  }
  if (state.connected && !previousState?.connected) addEvent('USB connection opened.');
  if (!state.connected && previousState?.connected) addEvent('Arduino disconnected.');
  previousState = state;
}

export async function prepareUpload() {
  if (monitor.state.phase === 'opening') throw new Error('Complete or cancel USB port selection before uploading.');
  uploading = true;
  updateControls();
  await monitor.disconnect();
}

export function finishUpload() {
  uploading = false;
  updateControls();
}

for (const button of chooseButtons) button.addEventListener('click', () => monitor.connect());
for (const button of reconnectButtons) button.addEventListener('click', () => monitor.reconnect());
for (const button of disconnectButtons) {
  button.addEventListener('click', () => monitor.disconnect().catch(error => setConnectionStatus(error.message, true)));
}
document.querySelector('#clear-serial').addEventListener('click', () => {
  serialLines.length = 0;
  serialLog.textContent = '';
});
monitor.subscribe(renderMonitor);
