const framePattern = /^DI0=([01])\s+DI1=([01])\s+DI2=([01])\s+DI3=([01])\s+DI4=([01])\s+DI5=([01])\s+DI6=([01])\s+DI7=([01])(?:\s+AI0=(\d+\.\d+)\s+AI1=(\d+\.\d+)\s+AI2=(\d+\.\d+)(?:\s+ADC0=(\d{1,5})\s+ADC1=(\d{1,5})\s+ADC2=(\d{1,5}))?)?$/;

export function parseSignalFrame(line) {
  const match = framePattern.exec(line.trim());
  if (!match) return null;
  return {
    digital: match.slice(1, 9).map(Number),
    analog: match[9] === undefined ? [] : match.slice(9, 12).map(Number),
    adc: match[12] === undefined ? [] : match.slice(12, 15).map(Number),
    timestamp: Date.now(),
  };
}

// Both pages use the same read-only Web Serial connection and frame timeout.
export function createSignalMonitor({ onLines } = {}) {
  const serial = navigator.serial;
  const listeners = new Set();
  let phase = serial ? 'disconnected' : 'unsupported';
  let message = serial ? 'Ingen Arduino tilsluttet' : 'Brug Chrome eller Edge til Arduino via USB.';
  let frame = null;
  let connection = null;
  let lastPort;
  let approved = [];
  let portListVersion = 0;
  let attempt = null;

  function reconnectPort() {
    if (approved.includes(lastPort) && lastPort.connected !== false) return lastPort;
    return approved.length === 1 ? approved[0] : undefined;
  }

  function snapshot() {
    const canChoose = Boolean(serial) && !attempt && !connection;
    return {
      phase, message, frame,
      connected: Boolean(connection),
      canChoose,
      canReconnect: canChoose && Boolean(reconnectPort()),
      canDisconnect: Boolean(connection) && !connection.stopping,
    };
  }

  function publish() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function update(nextPhase, nextMessage, nextFrame = null) {
    phase = nextPhase;
    message = nextMessage;
    frame = nextFrame;
    publish();
  }

  async function refreshPorts() {
    const version = ++portListVersion;
    const ports = await serial.getPorts().catch(() => []);
    if (version !== portListVersion) return;
    approved = ports.filter(port => port.connected !== false);
    publish();
  }

  function waitForFrame(link) {
    clearTimeout(link.timer);
    link.timer = setTimeout(() => {
      if (connection !== link || link.stopping) return;
      update('stale', link.receivedSerial
        ? 'USB tilsluttet. Ingen nye DI0–DI7-målinger.'
        : 'Ingen Arduino-data. Tjek skitsen og porten.');
    }, 2500);
  }

  async function read(link) {
    const decoder = new TextDecoder();
    let buffer = '';
    let failed = false;
    try {
      while (!link.stopping) {
        const { value, done } = await link.reader.read();
        if (done || link.stopping) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        if (buffer.length > 1024) buffer = '';
        if (!lines.length) continue;
        link.receivedSerial = true;
        onLines?.(lines);
        for (const line of lines) {
          const nextFrame = parseSignalFrame(line);
          if (!nextFrame) continue;
          update('live', 'Arduino tilsluttet', nextFrame);
          waitForFrame(link);
        }
      }
    } catch {
      failed = !link.stopping;
    } finally {
      clearTimeout(link.timer);
      link.reader.releaseLock();
      await link.port.close().catch(error => { link.closeError = error; });
      connection = null;
      update(failed || link.closeError ? 'error' : 'disconnected', failed || link.closeError
        ? 'Arduino-forbindelsen blev afbrudt. Kontrollér USB-porten.'
        : 'Arduino afbrudt.');
      void refreshPorts();
    }
  }

  async function open(choose) {
    if (!serial || attempt || connection) return;
    const currentAttempt = { cancelled: false };
    attempt = currentAttempt;
    update('opening', 'Åbner USB-forbindelse…');
    let port;
    let opened = false;
    try {
      port = choose ? await serial.requestPort() : reconnectPort();
      if (!port || currentAttempt.cancelled) {
        update('disconnected', 'Ingen Arduino tilsluttet');
        return;
      }
      await port.open({ baudRate: 115200 });
      opened = true;
      if (currentAttempt.cancelled) {
        await port.close();
        update('disconnected', 'Arduino afbrudt.');
        return;
      }
      const link = { port, reader: port.readable.getReader(), stopping: false };
      connection = link;
      lastPort = port;
      link.reading = read(link);
      waitForFrame(link);
      update('waiting', 'Venter på signaler fra Arduino…');
    } catch (error) {
      if (opened) await port.close().catch(() => {});
      if (error.name === 'NotFoundError' || currentAttempt.cancelled) {
        update('disconnected', 'Ingen Arduino tilsluttet');
      } else {
        update('error', 'Porten kunne ikke åbnes. Luk Serial Monitor og prøv igen.');
      }
    } finally {
      attempt = null;
      publish();
      void refreshPorts();
    }
  }

  async function disconnect() {
    if (attempt) attempt.cancelled = true;
    const link = connection;
    if (!link) return;
    if (!link.stopping) {
      link.stopping = true;
      clearTimeout(link.timer);
      update('closing', 'Frigiver USB-porten…');
      await link.reader.cancel().catch(() => {});
    }
    await link.reading;
    if (link.closeError) throw new Error('USB-porten kunne ikke frigives. Tilslut Arduino igen.');
  }

  if (serial) {
    serial.addEventListener('connect', refreshPorts);
    serial.addEventListener('disconnect', refreshPorts);
    window.addEventListener('pagehide', () => { void disconnect().catch(() => {}); });
    void refreshPorts();
  }
  return {
    get state() { return snapshot(); },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    connect: () => open(true),
    reconnect: () => open(false),
    disconnect,
  };
}
