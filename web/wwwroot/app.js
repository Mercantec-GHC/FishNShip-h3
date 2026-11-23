const serial = navigator.serial;
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
const voltageFormat = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const lastChange = document.querySelector('#last-change');
const serialLog = document.querySelector('#serial-log');
const serialLines = [];
const inputRows = Array.from(document.querySelectorAll('#input-rows tr')).map(row => ({
  row,
  level: row.querySelector('.input-level'),
  highlightTimer: null,
}));

const timeFormat = new Intl.DateTimeFormat('da-DK', { timeStyle: 'medium' });
const framePattern = /^DI0=([01])\s+DI1=([01])\s+DI2=([01])\s+DI3=([01])\s+DI4=([01])\s+DI5=([01])\s+DI6=([01])\s+DI7=([01])(?:\s+AI0=(\d+\.\d+)\s+AI1=(\d+\.\d+)\s+AI2=(\d+\.\d+)(?:\s+ADC0=(\d{1,5})\s+ADC1=(\d{1,5})\s+ADC2=(\d{1,5}))?)?$/;
let opening = false;
let connection = null;
let liveTimer;
let lastLevels = null;
let uploading = false;
let approvedPorts = [];
let lastPort;
let portListVersion = 0;

function levelLabel(value) {
  return value === 1 ? 'Høj' : 'Lav';
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

function reconnectPort() {
  if (approvedPorts.includes(lastPort) && lastPort.connected !== false) return lastPort;
  return approvedPorts.length === 1 ? approvedPorts[0] : undefined;
}

async function refreshApprovedPorts() {
  if (!serial) return;
  const version = ++portListVersion;
  const ports = await serial.getPorts().catch(() => []);
  if (version !== portListVersion) return;
  approvedPorts = ports.filter(port => port.connected !== false);
  updateControls();
}

function showInputs(levels, voltages = [], counts = []) {
  analogRows.forEach((row, channel) => {
    const value = voltages[channel];
    const count = counts[channel];
    const hasReading = Number.isFinite(value);
    const hasRaw = Number.isInteger(count) && count >= 0 && count <= 65535;
    const saturated = count === 65535 || (!hasRaw && hasReading && value >= 10.692);
    const status = !hasReading ? 'Ingen måling' : saturated ? 'Mættet' : value > 10 ? 'Over 10 V' : 'Inden for 0–10 V';
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
    const text = value === undefined ? 'Ingen måling' : `${levelLabel(value)} (${value})`;
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
  inputCount.textContent = levels ? `${levels.reduce((sum, value) => sum + value, 0)} af ${levels.length} høje` : 'Ingen aflæsning';
  if (changes.length) {
    const message = changes.join(' / ');
    lastChange.textContent = `Seneste skift: ${message}`;
    addEvent(message);
  }
}

function updateControls() {
  const canConnect = Boolean(serial) && !connection && !opening && !uploading;
  for (const button of chooseButtons) button.disabled = !canConnect;
  for (const button of reconnectButtons) button.disabled = !canConnect || !reconnectPort();
  for (const button of disconnectButtons) button.disabled = !connection || opening || uploading || connection.stopping;
}

function resetReadings(message) {
  inputSource.textContent = message;
  lastChange.textContent = 'Seneste skift vises her.';
  showInputs(null);
  updateControls();
}

function waitForFrame() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    showInputs(null);
    inputSource.textContent = 'Ingen nye målinger fra Arduino.';
    const message = connection?.receivedSerial
      ? 'USB tilsluttet. Ingen nye DI0–DI7-målinger.'
      : 'Ingen Arduino-data. Tjek skitsen og porten.';
    setConnectionStatus(message, !connection?.receivedSerial);
  }, 2500);
}

async function listenToArduino(link) {
  const decoder = new TextDecoder();
  let buffer = '';
  let status = 'Arduino afbrudt.';
  let error = false;
  try {
    while (!link.stopping) {
      const { value, done } = await link.reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      if (buffer.length > 1024) buffer = '';

      if (lines.length) {
        link.receivedSerial = true;
        const follow = serialLog.scrollHeight - serialLog.scrollTop - serialLog.clientHeight < 24;
        for (const line of lines) {
          serialLines.push(line.trimEnd().slice(0, 1024));
          if (serialLines.length > 150) serialLines.shift();
        }
        serialLog.textContent = serialLines.join('\n');
        if (follow) serialLog.scrollTop = serialLog.scrollHeight;
      }
      for (const line of lines) {
        const frame = framePattern.exec(line.trim());
        if (!frame) continue;
        showInputs(frame.slice(1, 9).map(Number), frame.slice(9, 12).map(Number), frame.slice(12, 15).map(Number));
        inputSource.textContent = 'Live fra Arduino via USB';
        setConnectionStatus('Arduino tilsluttet');
        waitForFrame();
      }
    }
  } catch {
    status = 'Arduino-forbindelsen blev afbrudt.';
    error = true;
  } finally {
    clearTimeout(liveTimer);
    link.reader.releaseLock();
    await link.port.close().catch(error => { link.closeError = error; });
    connection = null;
    resetReadings('Tilslut Arduino via USB for at se signaler.');
    setConnectionStatus(status, error);
    addEvent('Arduino afbrudt.');
    void refreshApprovedPorts();
  }
}

async function closeArduino() {
  const link = connection;
  if (!link) return;
  link.stopping = true;
  updateControls();
  await link.reader.cancel().catch(() => {});
  await link.reading;
  if (link.closeError) throw new Error('USB-porten kunne ikke frigives. Tilslut Arduino igen, før du uploader.');
}

export async function prepareUpload() {
  if (opening) throw new Error('Luk eller fuldfør valg af USB-porten før upload.');
  uploading = true;
  updateControls();
  await closeArduino();
}

export function finishUpload() {
  uploading = false;
  updateControls();
}

async function connectArduino(choose) {
  if (!serial || connection || opening || uploading) return;
  opening = true;
  updateControls();
  let port;
  let opened = false;
  try {
    port = choose ? await serial.requestPort() : reconnectPort();
    if (!port) return;
    await port.open({ baudRate: 115200 });
    opened = true;
    connection = { port, reader: port.readable.getReader(), stopping: false };
    lastPort = port;
    resetReadings('Venter på målinger fra Arduino…');
    setConnectionStatus('Venter på signaler fra Arduino…');
    addEvent('USB-forbindelse åbnet.');
    waitForFrame();
    connection.reading = listenToArduino(connection);
  } catch (error) {
    if (opened) await port.close().catch(() => {});
    if (error.name === 'NotFoundError') {
      setConnectionStatus('Ingen Arduino tilsluttet');
    } else {
      setConnectionStatus('Porten kunne ikke åbnes. Luk Serial Monitor og prøv igen.', true);
    }
  } finally {
    opening = false;
    updateControls();
    void refreshApprovedPorts();
  }
}

for (const button of chooseButtons) button.addEventListener('click', () => connectArduino(true));
for (const button of reconnectButtons) button.addEventListener('click', () => connectArduino(false));
for (const button of disconnectButtons) {
  button.addEventListener('click', () => closeArduino().catch(error => setConnectionStatus(error.message, true)));
}
document.querySelector('#clear-serial').addEventListener('click', () => {
  serialLines.length = 0;
  serialLog.textContent = '';
});
updateControls();
if (serial) {
  serial.addEventListener('connect', refreshApprovedPorts);
  serial.addEventListener('disconnect', refreshApprovedPorts);
  void refreshApprovedPorts();
} else {
  setConnectionStatus('Brug Chrome eller Edge til Arduino via USB.');
}
