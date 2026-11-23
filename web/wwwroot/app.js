const connectButton = document.querySelector('#connect');
const connectionStatus = document.querySelector('#connection-status');
const cycleButton = document.querySelector('#run');
const slots = Array.from(document.querySelectorAll('.rack-position'));
const diagram = document.querySelector('#diagram');
const phaseLabel = document.querySelector('#phase');
const occupancyLabel = document.querySelector('#occupancy');
const simulationHint = document.querySelector('#sim-hint');
const inputSource = document.querySelector('#input-source');
const inputHint = document.querySelector('#input-hint');
const eventList = document.querySelector('#events');
const inputRows = Array.from(document.querySelectorAll('#input-rows tr')).map(row => ({
  name: row.cells[1],
  simulationName: row.cells[1].textContent,
  level: row.querySelector('.input-level'),
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
  if (connectionStatus.textContent !== message) {
    connectionStatus.textContent = message;
  }
  connectionStatus.toggleAttribute('data-error', error);
}

function showInputs(levels, source) {
  const changes = [];
  inputRows.forEach(({ level }, channel) => {
    const value = levels?.[channel];
    const text = value === undefined ? '–' : String(value);
    if (level.textContent !== text) {
      level.textContent = text;
    }
    level.toggleAttribute('data-high', value === 1);
    if (levels && lastLevels && value !== lastLevels[channel]) {
      changes.push(`DI${channel}=${value}`);
    }
  });
  lastLevels = levels;
  if (changes.length) {
    addEvent(`${source} · ${changes.join(', ')}`);
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
  connectButton.disabled = !('serial' in navigator) || opening || cycleRunning || Boolean(connection?.stopping);
  connectButton.textContent = connection ? 'Afbryd Arduino' : 'Tilslut Arduino';
  simulationHint.textContent = connection ? 'Afbryd Arduino for at køre en lagercyklus.' : 'Vælg en plads i reolen, og kør en lagercyklus.';
  occupancyLabel.textContent = `${storedSlots.size} af ${slots.length} pladser optaget`;
}

function showMode(live) {
  lastLevels = null;
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
    setConnectionStatus('Ingen Arduino-data. Tjek skitsen og porten.', true);
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
    await link.port.close().catch(() => {});
    connection = null;
    showMode(false);
    setConnectionStatus(status, error);
    addEvent('Arduino afbrudt.');
  }
}

async function toggleArduino() {
  if (connection) {
    connection.stopping = true;
    updateControls();
    await connection.reader.cancel().catch(() => {});
    return;
  }

  opening = true;
  updateControls();
  let port;
  let opened = false;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    opened = true;
    connection = { port, reader: port.readable.getReader(), stopping: false };
    showMode(true);
    setConnectionStatus('Venter på signaler fra Arduino…');
    addEvent('USB-forbindelse åbnet.');
    waitForFrame();
    void listenToArduino(connection);
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
  }
}

for (const slot of slots) {
  slot.addEventListener('click', () => {
    selectedSlot = slot.dataset.position;
    updateControls();
  });
}
cycleButton.addEventListener('click', runCycle);
connectButton.addEventListener('click', toggleArduino);
showMode(false);
if (!('serial' in navigator)) {
  setConnectionStatus('Brug Chrome eller Edge til Arduino via USB.');
}
