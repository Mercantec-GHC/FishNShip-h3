const serial = navigator.serial;
const chooseButtons = document.querySelectorAll('[data-usb="choose"]');
const reconnectButtons = document.querySelectorAll('[data-usb="reconnect"]');
const disconnectButtons = document.querySelectorAll('[data-usb="disconnect"]');
const connectionStatus = document.querySelector('#connection-status');
const monitorStatus = document.querySelector('#monitor-status');
const cycleButton = document.querySelector('#run');
const slots = Array.from(document.querySelectorAll('.rack-position'));
const diagram = document.querySelector('#diagram');
const phaseLabel = document.querySelector('#phase');
const occupancyLabel = document.querySelector('#occupancy');
const simulationHint = document.querySelector('#sim-hint');
const inputSource = document.querySelector('#input-source');
const inputHint = document.querySelector('#input-hint');
const eventList = document.querySelector('#events');
const inputCount = document.querySelector('#input-count');
const lastChange = document.querySelector('#last-change');
const serialLog = document.querySelector('#serial-log');
const serialLines = [];
const inputRows = Array.from(document.querySelectorAll('#input-rows tr')).map(row => ({
  row,
  name: row.cells[1],
  simulationName: row.cells[1].textContent,
  level: row.querySelector('.input-level'),
  highlightTimer: null,
}));

const idleLevels = [1, 0, 0, 1, 0, 1, 0, 0];
const storedSlots = new Set();
const timeFormat = new Intl.DateTimeFormat('da-DK', { timeStyle: 'medium' });
const framePattern = /^DI0=([01])\s+DI1=([01])\s+DI2=([01])\s+DI3=([01])\s+DI4=([01])\s+DI5=([01])\s+DI6=([01])\s+DI7=([01])$/;
let selectedSlot = 'A3';
let cycleRunning = false;
let opening = false;
let connection = null;
let liveTimer;
let lastLevels = null;
let uploading = false;
let approvedPorts = [];
let lastPort;
let portListVersion = 0;

function levelLabel(value) {
  if (value === undefined) return 'Intet signal';
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

function showInputs(levels, source) {
  const changes = [];
  inputRows.forEach((channelRow, channel) => {
    const { row, level } = channelRow;
    const value = levels?.[channel];
    const text = value === undefined ? levelLabel(value) : `${levelLabel(value)} (${value})`;
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
    addEvent(`${source} · ${message}`);
  }
}

function updateControls() {
  const simulationDisabled = opening || Boolean(connection) || cycleRunning;
  for (const slot of slots) {
    const filled = storedSlots.has(slot.dataset.position);
    slot.disabled = simulationDisabled;
    slot.setAttribute('aria-pressed', String(slot.dataset.position === selectedSlot));
    slot.setAttribute('aria-label', `${slot.dataset.position}, ${filled ? 'optaget' : 'ledig'}`);
    slot.toggleAttribute('data-filled', filled);
  }
  cycleButton.disabled = simulationDisabled;
  cycleButton.textContent = storedSlots.has(selectedSlot) ? `Hent fra ${selectedSlot}` : `Læg ind på ${selectedSlot}`;
  const canConnect = Boolean(serial) && !connection && !opening && !cycleRunning && !uploading;
  for (const button of chooseButtons) button.disabled = !canConnect;
  for (const button of reconnectButtons) button.disabled = !canConnect || !reconnectPort();
  for (const button of disconnectButtons) button.disabled = !connection || opening || uploading || connection.stopping;
  simulationHint.textContent = connection ? 'Afbryd Arduino for at køre en lagercyklus.' : 'Vælg en plads i reolen, og kør en lagercyklus.';
  occupancyLabel.textContent = `${storedSlots.size} af ${slots.length} pladser optaget`;
}

function showMode(live) {
  lastLevels = null;
  lastChange.textContent = 'Seneste skift vises her.';
  for (const row of inputRows) {
    row.name.textContent = live ? 'Portenta-indgang' : row.simulationName;
  }
  inputSource.textContent = live ? 'Arduino via USB' : 'Simulerede signaler';
  inputHint.textContent = live ? 'Kanalernes sensornavne afhænger af jeres tilslutning.' : 'Sensornavnene viser demoens tilslutning.';
  phaseLabel.textContent = live ? 'Lagersimulering sat på pause' : 'Klar ved referencepositionen';
  showInputs(live ? null : idleLevels);
  updateControls();
}

function makeCycle(slot, retrieving) {
  const moveToRack = ['move', `Kranen kører til ${slot}`, [0, 0, 0, 0, 0, 1, 0, 0]];
  const transfer = ['transfer', retrieving ? `Kranen henter emnet fra ${slot}` : `Kranen lægger emnet på ${slot}`, [0, 0, 0, 0, 1, 0, 0, 0]];
  const belt = ['belt', 'Transportbåndet flytter emnet', [1, 1, 0, 1, 0, 1, 0, 0]];
  const detect = ['detect', 'Ydre lysbarriere registrerer emnet', [1, 0, 1, 1, 0, 1, 0, 0]];
  return retrieving ? [moveToRack, transfer, belt, detect] : [detect, belt, moveToRack, transfer];
}

async function runCycle() {
  cycleRunning = true;
  updateControls();
  const slot = selectedSlot;
  const slotButton = slots.find(button => button.dataset.position === slot);
  const retrieving = storedSlots.has(slot);
  const targetLevel = Number(slot.slice(1));
  const liftStep = diagram.querySelector('.rack-position').offsetHeight;
  diagram.style.setProperty('--target-height', `${-(targetLevel - 1) * liftStep}px`);

  for (const [phase, message, levels] of makeCycle(slot, retrieving)) {
    diagram.dataset.phase = phase;
    slotButton.toggleAttribute('data-target', phase === 'move' || phase === 'transfer');
    phaseLabel.textContent = message;
    showInputs(levels, 'Simulering');
    addEvent(message);
    await new Promise(resolve => setTimeout(resolve, 740));

    if (phase === 'transfer') {
      if (retrieving) {
        storedSlots.delete(slot);
      } else {
        storedSlots.add(slot);
      }
      updateControls();
    }
  }

  diagram.dataset.phase = 'idle';
  slotButton.removeAttribute('data-target');
  phaseLabel.textContent = 'Klar ved referencepositionen';
  showInputs(idleLevels, 'Simulering');
  addEvent(retrieving ? `Emnet fra ${slot} er kørt ud.` : `Emnet er lagt på ${slot}.`);
  cycleRunning = false;
  updateControls();
  if (document.activeElement === document.body) cycleButton.focus();
}

function waitForFrame() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    showInputs(null);
    const message = connection?.receivedSerial
      ? 'USB tilsluttet. Ingen nye DI0–DI7-målinger.'
      : 'Ingen Arduino-data. Tjek skitsen og porten.';
    setConnectionStatus(message, !connection?.receivedSerial);
  }, 2500);
}

async function listenToArduino(link) {
  const decoder = new TextDecoder();
  let buffer = '';
  let status = 'Arduino afbrudt. Simulering aktiv.';
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
        showInputs(frame.slice(1).map(Number), 'Arduino');
        setConnectionStatus('Arduino tilsluttet');
        waitForFrame();
      }
    }
  } catch {
    status = 'Arduino-forbindelsen blev afbrudt. Simulering aktiv.';
    error = true;
  } finally {
    clearTimeout(liveTimer);
    link.reader.releaseLock();
    await link.port.close().catch(error => { link.closeError = error; });
    connection = null;
    showMode(false);
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
  if (!serial || connection || opening || uploading || cycleRunning) return;
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
    showMode(true);
    setConnectionStatus('Venter på signaler fra Arduino…');
    addEvent('USB-forbindelse åbnet.');
    waitForFrame();
    connection.reading = listenToArduino(connection);
  } catch (error) {
    if (opened) await port.close().catch(() => {});
    if (error.name === 'NotFoundError') {
      setConnectionStatus('Simulering aktiv');
    } else {
      setConnectionStatus('Porten kunne ikke åbnes. Luk Serial Monitor og prøv igen.', true);
    }
  } finally {
    opening = false;
    updateControls();
    void refreshApprovedPorts();
  }
}

for (const slot of slots) {
  slot.addEventListener('click', () => {
    selectedSlot = slot.dataset.position;
    updateControls();
  });
}
cycleButton.addEventListener('click', runCycle);
for (const button of chooseButtons) button.addEventListener('click', () => connectArduino(true));
for (const button of reconnectButtons) button.addEventListener('click', () => connectArduino(false));
for (const button of disconnectButtons) {
  button.addEventListener('click', () => closeArduino().catch(error => setConnectionStatus(error.message, true)));
}
document.querySelector('#clear-serial').addEventListener('click', () => {
  serialLines.length = 0;
  serialLog.textContent = '';
});
showMode(false);
if (serial) {
  serial.addEventListener('connect', refreshApprovedPorts);
  serial.addEventListener('disconnect', refreshApprovedPorts);
  void refreshApprovedPorts();
} else {
  setConnectionStatus('Brug Chrome eller Edge til Arduino via USB.');
}
