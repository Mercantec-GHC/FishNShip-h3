const digitalPattern = /^DI0=([01])\s+DI1=([01])\s+DI2=([01])\s+DI3=([01])\s+DI4=([01])\s+DI5=([01])\s+DI6=([01])\s+DI7=([01])(?=\s|$)/;
const analogPattern = /^\s+(?:AI|Analog)0=(\d+\.\d+)\s+(?:AI|Analog)1=(\d+\.\d+)\s+(?:AI|Analog)2=(\d+\.\d+)(?=\s|$)(?:\s+ADC0=(\d{1,5})\s+ADC1=(\d{1,5})\s+ADC2=(\d{1,5})(?=\s|$))?/;

export function parseSignalFrame(line) {
  const text = line.trim();
  const digital = digitalPattern.exec(text);
  if (!digital) return null;
  // The sketch can append its own telemetry after the eight digital levels.
  const analog = analogPattern.exec(text.slice(digital[0].length));
  return {
    digital: digital.slice(1).map(Number),
    analog: analog ? analog.slice(1, 4).map(Number) : [],
    adc: analog?.[4] === undefined ? [] : analog.slice(4, 7).map(Number),
    timestamp: Date.now(),
  };
}

// Both pages use the same read-only Web Serial connection and frame timeout.
export function createSignalMonitor({ onLines } = {}) {
  const serial = navigator.serial;
  const listeners = new Set();
  let phase = serial ? 'disconnected' : 'unsupported';
  let message = serial ? 'No Arduino connected' : 'Use Chrome or Edge to connect to Arduino via USB.';
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
        ? 'USB connected. No new DI0–DI7 readings.'
        : 'No Arduino data. Check the sketch and port.');
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
          update('live', 'Arduino connected', nextFrame);
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
        ? 'Arduino disconnected. Check the USB port.'
        : 'Arduino disconnected.');
      void refreshPorts();
    }
  }

  async function open(choose) {
    if (!serial || attempt || connection) return;
    const currentAttempt = { cancelled: false };
    attempt = currentAttempt;
    update('opening', 'Opening USB connection…');
    let port;
    let opened = false;
    try {
      port = choose ? await serial.requestPort() : reconnectPort();
      if (!port || currentAttempt.cancelled) {
        update('disconnected', 'No Arduino connected');
        return;
      }
      await port.open({ baudRate: 115200 });
      opened = true;
      if (currentAttempt.cancelled) {
        await port.close();
        update('disconnected', 'Arduino disconnected.');
        return;
      }
      const link = { port, reader: port.readable.getReader(), stopping: false };
      connection = link;
      lastPort = port;
      link.reading = read(link);
      waitForFrame(link);
      update('waiting', 'Waiting for signals from Arduino…');
    } catch (error) {
      if (opened) await port.close().catch(() => {});
      if (error.name === 'NotFoundError' || currentAttempt.cancelled) {
        update('disconnected', 'No Arduino connected');
      } else {
        update('error', 'Could not open the port. Close Serial Monitor and try again.');
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
      update('closing', 'Releasing USB port…');
      await link.reader.cancel().catch(() => {});
    }
    await link.reading;
    if (link.closeError) throw new Error('Could not release the USB port. Reconnect the Arduino.');
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
