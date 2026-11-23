import { finishUpload, prepareUpload } from './app.js?v=adc';
import { createArduinoEditor } from './vendor/arduino-editor.js';

const editorHost = document.querySelector('#sketch');
const cursorStatus = document.querySelector('#cursor-status');
const searchButton = document.querySelector('#search-sketch');
const downloadButton = document.querySelector('#download-sketch');
const firmwareDownload = document.querySelector('#download-firmware');
const sketchStatus = document.querySelector('#sketch-status');
const saveButton = document.querySelector('#save-sketch');
const compileButton = document.querySelector('#compile-sketch');
const uploadButton = document.querySelector('#upload-sketch');
const portSelect = document.querySelector('#upload-port');
const refreshButton = document.querySelector('#refresh-ports');
const portStatus = document.querySelector('#port-status');
const firmwareStatus = document.querySelector('#firmware-status');
const buildLog = document.querySelector('#build-log');
const bridgeForm = document.querySelector('#bridge-form');
const bridgeInput = document.querySelector('#hosted-bridge-key');
const bridgeStatus = document.querySelector('#bridge-status');
const pairButton = document.querySelector('#pair-bridge');
const showBridgeKey = document.querySelector('#show-bridge-key');
const localhost = 'http://localhost:5080';
const hosted = location.origin === 'https://fishnship.mercantec.tech';
const bridgeStorageKey = 'fishnship-upload-key';
const buildLines = [];
let editor;
let enabled = false;
let compileEnabled = false;
let bridgeKey = '';
let busy = false;
let listing = false;
let version;
let savedCode;
let compiledCode;
let firmwarePackage;
let showingDiagnostics = false;
let pairWindow;
let pairRequestId;

function rememberBridge(key) {
  bridgeKey = key;
  if (!hosted) return;
  try {
    if (key) sessionStorage.setItem(bridgeStorageKey, key);
    else sessionStorage.removeItem(bridgeStorageKey);
  } catch {
    // The bridge still works for the current page when session storage is blocked.
  }
}

function updateControls() {
  editor?.setReadOnly(busy);
  searchButton.disabled = !editor || busy;
  downloadButton.disabled = !editor || busy;
  firmwareDownload.disabled = !firmwarePackage || busy || editor?.value !== compiledCode;
  saveButton.disabled = !editor || !enabled || busy || savedCode === editor.value;
  compileButton.disabled = !editor || !compileEnabled || busy || !editor.value.trim();
  const uploadAvailable = enabled || Boolean(bridgeKey);
  refreshButton.disabled = !editor || (!uploadAvailable && !hosted) || busy || listing;
  portSelect.disabled = !uploadAvailable || busy || listing || portSelect.options.length < 2;
  pairButton.disabled = busy || listing;
  bridgeInput.disabled = busy || listing;
  const readyCode = editor && (enabled ? editor.value === compiledCode : editor.value.trim());
  uploadButton.disabled = !readyCode || !uploadAvailable || busy || listing || portSelect.options.length !== 2 || !portSelect.value;
  const action = enabled ? 'Upload' : 'Byg og upload';
  uploadButton.textContent = portSelect.value ? `${action} til ${portSelect.value}` : 'Upload firmware';
}

async function api(action, data, viaBridge = !enabled && (action === 'ports' || action === 'upload')) {
  const headers = { 'Content-Type': 'application/json' };
  if (viaBridge) headers['X-FishNShip-Key'] = bridgeKey;
  else headers['X-Lager-Editor'] = '1';
  let response;
  try {
    response = await fetch(viaBridge ? `${localhost}/api/usb/${action}` : `/api/firmware/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data ?? {}),
    });
  } catch (error) {
    if (!viaBridge) throw error;
    throw new Error('Kunne ikke nå localhost:5080. Start det lokale værktøj, og tillad lokal adgang i browseren.');
  }
  if (response.ok) return response;
  if (viaBridge && response.status === 403) {
    rememberBridge('');
    bridgeStatus.textContent = 'Uploadkoden er afvist. Hent en ny kode på localhost.';
    throw new Error(bridgeStatus.textContent);
  }
  const error = await response.json().catch(() => ({}));
  throw new Error(error.message || error.detail || `Siden kunne ikke fuldføre handlingen (${response.status}).`);
}

function showPorts(ports) {
  const previous = portSelect.value;
  portSelect.replaceChildren(new Option('Vælg Portenta', ''));
  for (const port of ports) portSelect.add(new Option(`Portenta H7 · ${port}`, port));
  if (ports.length === 1) portSelect.value = ports[0];
  else if (ports.includes(previous)) portSelect.value = previous;
  portStatus.textContent = ports.length === 1 ? `Portenta er valgt på ${ports[0]}.` : ports.length > 1 ? 'Lad kun den Portenta, I vil flashe, være tilsluttet.' : 'Ingen Portenta fundet. Tilslut USB, og klik Find port.';
}

async function refreshPorts() {
  listing = true;
  updateControls();
  portStatus.textContent = 'Leder efter Portenta via USB…';
  try {
    const ports = await (await api('ports')).json();
    showPorts(ports);
    return true;
  } catch (error) {
    showPorts([]);
    portStatus.textContent = error.message;
    return false;
  } finally {
    listing = false;
    updateControls();
  }
}

async function connectBridge(key) {
  bridgeKey = key;
  bridgeStatus.textContent = 'Forbinder til det lokale værktøj…';
  if (await refreshPorts()) {
    rememberBridge(key);
    bridgeStatus.textContent = 'Lokal upload er forbundet.';
    bridgeInput.value = '';
  } else {
    rememberBridge('');
    bridgeStatus.textContent = portStatus.textContent;
  }
  updateControls();
}

function findPorts() {
  if (enabled || bridgeKey) {
    void refreshPorts();
    return;
  }

  pairRequestId = crypto.randomUUID();
  pairWindow = window.open(`${localhost}/upload-pair.html#${pairRequestId}`, 'fishnship-local-upload', 'popup,width=620,height=440');
  portStatus.textContent = pairWindow
    ? 'Godkend forbindelsen i det lokale vindue.'
    : 'Tillad pop op-vinduer, eller vælg Forbind med uploadkode.';
}

window.addEventListener('message', event => {
  if (event.origin !== localhost || !pairWindow || event.source !== pairWindow ||
      event.data?.type !== 'fishnship-upload-approved' || event.data.requestId !== pairRequestId ||
      typeof event.data.key !== 'string' || !/^[A-F0-9]{32}$/.test(event.data.key) ||
      !Array.isArray(event.data.ports) || !event.data.ports.every(port => typeof port === 'string')) return;

  pairWindow = undefined;
  pairRequestId = undefined;
  rememberBridge(event.data.key);
  showPorts(event.data.ports);
  bridgeStatus.textContent = 'Lokal upload er forbundet.';
  updateControls();
});

async function revealBridgeKey() {
  try {
    const { key } = await (await api('bridge-key')).json();
    const field = document.querySelector('#local-bridge-key');
    field.value = key;
    field.hidden = false;
    field.focus();
    field.select();
  } catch (error) {
    portStatus.textContent = error.message;
  }
}

async function loadSketch() {
  try {
    const response = await fetch('/api/firmware/sketch', { cache: 'no-store' });
    if (!response.ok) throw new Error('Demo.ino kunne ikke læses.');
    const sketch = await response.json();
    editor = createArduinoEditor({
      parent: editorHost,
      doc: sketch.code,
      onChange: editorChanged,
      onCursor: (line, column) => { cursorStatus.textContent = `Linje ${line}, kolonne ${column}`; },
      onSave: () => {
        if (!saveButton.disabled) void saveSketch();
        if (!enabled && !downloadButton.disabled) downloadSketch();
      },
      onCompile: () => { if (!compileButton.disabled) void runFirmware('compile'); },
    });
    savedCode = editor.value;
    version = sketch.version;
    enabled = sketch.enabled;
    compileEnabled = sketch.compileEnabled ?? enabled;
    sketchStatus.textContent = enabled ? 'Demo.ino er åben' : 'Lokal kladde';
    document.querySelector('#local-bridge').hidden = !enabled;
    document.querySelector('#hosted-bridge').hidden = enabled || location.protocol !== 'https:';
    document.querySelector('#firmware-package').hidden = enabled || !compileEnabled;
    if (hosted) {
      try { bridgeKey = sessionStorage.getItem(bridgeStorageKey) ?? ''; }
      catch { bridgeKey = ''; }
    }
    if (enabled) void refreshPorts();
    else {
      document.querySelector('#upload-port-label').textContent = 'Port til upload via localhost (valgfrit)';
      portStatus.textContent = 'Find port bruger det lokale værktøj.';
      firmwareStatus.textContent = compileEnabled
        ? 'Kompilér koden for at hente firmwarepakken.'
        : 'Du kan hente kladden som .ino. Kompilering og upload kører på localhost.';
    }
  } catch (error) {
    sketchStatus.textContent = error.message;
  }
  updateControls();
}

function downloadFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSketch() {
  downloadFile(editor.value, 'text/plain;charset=utf-8', 'Demo.ino');
}

async function saveSketch() {
  busy = true;
  updateControls();
  try {
    const { version: newVersion } = await (await api('sketch', { code: editor.value, version })).json();
    savedCode = editor.value;
    version = newVersion;
    sketchStatus.textContent = 'Gemt i Demo.ino';
  } catch (error) {
    sketchStatus.textContent = error.message;
  } finally {
    busy = false;
    updateControls();
  }
}

function appendBuildLine(line) {
  buildLines.push(line);
  if (buildLines.length > 180) buildLines.shift();
  const follow = buildLog.scrollHeight - buildLog.scrollTop - buildLog.clientHeight < 24;
  buildLog.textContent = buildLines.join('\n');
  if (follow) buildLog.scrollTop = buildLog.scrollHeight;
}

async function readBuildStream(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let result;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const entry = JSON.parse(line);
        if (entry.line) appendBuildLine(entry.line);
        if ('success' in entry) result = entry;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error('Forbindelsen til den lokale server blev afbrudt.');
  return result;
}

async function runFirmware(action) {
  const uploading = action === 'upload';
  busy = true;
  const code = editor.value;
  const port = portSelect.value;
  if (!uploading) {
    compiledCode = undefined;
    firmwarePackage = undefined;
    editor.showDiagnostics([]);
    showingDiagnostics = false;
  }
  firmwareStatus.textContent = uploading ? 'Frigiver USB-porten…' : 'Kompilering i gang…';
  firmwareStatus.removeAttribute('data-error');
  buildLines.length = 0;
  buildLog.textContent = '';
  updateControls();
  try {
    if (uploading) await prepareUpload();
    if (uploading && !enabled) {
      firmwareStatus.textContent = 'Bygger firmware på Arduino-computeren…';
      const localBuild = await readBuildStream(await api('compile', { code }, true));
      if (!localBuild.success) {
        editor.showDiagnostics(buildLines);
        showingDiagnostics = true;
        throw new Error(localBuild.message);
      }
      firmwareStatus.textContent = `Uploader til ${port}…`;
    }
    const result = await readBuildStream(await api(action, { code, port }));
    if (!uploading) {
      if (result.success) {
        compiledCode = code;
        firmwarePackage = result.firmwarePackage;
      }
      editor.showDiagnostics(buildLines);
      showingDiagnostics = true;
    }
    firmwareStatus.textContent = result.message;
    firmwareStatus.toggleAttribute('data-error', !result.success);
    appendBuildLine(result.message);
  } catch (error) {
    firmwareStatus.textContent = error.message;
    firmwareStatus.setAttribute('data-error', '');
  } finally {
    if (uploading) finishUpload();
    busy = false;
    updateControls();
  }
}

function editorChanged() {
  sketchStatus.textContent = editor.value === savedCode ? 'Demo.ino er åben' : 'Ændringer ikke gemt';
  if (showingDiagnostics) {
    showingDiagnostics = false;
    queueMicrotask(() => editor.showDiagnostics([]));
  }
  if (enabled && compiledCode) {
    firmwareStatus.textContent = editor.value === compiledCode ? 'Kompileret og klar til upload.' : 'Kompilér ændringerne før upload.';
    firmwareStatus.removeAttribute('data-error');
  }
  updateControls();
}
window.addEventListener('beforeunload', event => {
  if (editor && savedCode !== editor.value) event.preventDefault();
});
searchButton.addEventListener('click', () => editor.search());
bridgeForm.addEventListener('submit', event => {
  event.preventDefault();
  void connectBridge(bridgeInput.value.trim().toUpperCase());
});
showBridgeKey.addEventListener('click', revealBridgeKey);
downloadButton.addEventListener('click', downloadSketch);
firmwareDownload.addEventListener('click', () => {
  const bytes = Uint8Array.from(atob(firmwarePackage), character => character.charCodeAt(0));
  downloadFile(bytes, 'application/zip', 'FishNShip-Portenta-M7.zip');
});
saveButton.addEventListener('click', saveSketch);
refreshButton.addEventListener('click', findPorts);
portSelect.addEventListener('change', updateControls);
compileButton.addEventListener('click', () => runFirmware('compile'));
uploadButton.addEventListener('click', () => runFirmware('upload'));
void loadSketch();
