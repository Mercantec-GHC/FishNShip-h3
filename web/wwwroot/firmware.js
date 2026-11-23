import { finishUpload, prepareUpload } from './app.js?v=analog';
import { createArduinoEditor } from './vendor/arduino-editor.js';

const editorHost = document.querySelector('#sketch');
const cursorStatus = document.querySelector('#cursor-status');
const searchButton = document.querySelector('#search-sketch');
const downloadButton = document.querySelector('#download-sketch');
const sketchStatus = document.querySelector('#sketch-status');
const saveButton = document.querySelector('#save-sketch');
const compileButton = document.querySelector('#compile-sketch');
const uploadButton = document.querySelector('#upload-sketch');
const portSelect = document.querySelector('#upload-port');
const refreshButton = document.querySelector('#refresh-ports');
const portStatus = document.querySelector('#port-status');
const firmwareStatus = document.querySelector('#firmware-status');
const buildLog = document.querySelector('#build-log');
const buildLines = [];
let editor;
let enabled = false;
let busy = false;
let listing = false;
let version;
let savedCode;
let compiledCode;
let showingDiagnostics = false;

function updateControls() {
  editor?.setReadOnly(busy);
  searchButton.disabled = !editor || busy;
  downloadButton.disabled = !editor || busy;
  saveButton.disabled = !editor || !enabled || busy || savedCode === editor.value;
  compileButton.disabled = !editor || !enabled || busy || !editor.value.trim();
  refreshButton.disabled = !enabled || busy || listing;
  portSelect.disabled = !enabled || busy || listing || portSelect.options.length < 2;
  uploadButton.disabled = !editor || !enabled || busy || listing || portSelect.options.length !== 2 || !portSelect.value || editor.value !== compiledCode;
  uploadButton.textContent = portSelect.value ? `Upload til ${portSelect.value}` : 'Upload firmware';
}

async function api(action, data) {
  const response = await fetch(`/api/firmware/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lager-Editor': '1' },
    body: JSON.stringify(data ?? {}),
  });
  if (response.ok) return response;
  const error = await response.json().catch(() => ({}));
  throw new Error(error.message || error.detail || `Siden kunne ikke fuldføre handlingen (${response.status}).`);
}

async function refreshPorts() {
  listing = true;
  updateControls();
  portStatus.textContent = 'Leder efter Portenta via USB…';
  const previous = portSelect.value;
  portSelect.replaceChildren(new Option('Vælg Portenta', ''));
  try {
    const ports = await (await api('ports')).json();
    for (const port of ports) portSelect.add(new Option(`Portenta H7 · ${port}`, port));
    if (ports.length === 1) portSelect.value = ports[0];
    else if (ports.includes(previous)) portSelect.value = previous;
    portStatus.textContent = ports.length === 1 ? 'Portenta er fundet.' : ports.length > 1 ? 'Lad kun den Portenta, I vil flashe, være tilsluttet.' : 'Ingen Portenta fundet. Tilslut USB, og klik Find port.';
  } catch (error) {
    portStatus.textContent = error.message;
  } finally {
    listing = false;
    updateControls();
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
    sketchStatus.textContent = enabled ? 'Demo.ino er åben' : 'Lokal kladde';
    if (enabled) void refreshPorts();
    else {
      portStatus.textContent = 'Start siden med .NET på Arduino-computeren for at bruge uploadporten.';
      firmwareStatus.textContent = 'Du kan hente kladden som .ino. Kompilering og upload kører på localhost.';
    }
  } catch (error) {
    sketchStatus.textContent = error.message;
  }
  updateControls();
}

function downloadSketch() {
  const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Demo.ino';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const result = await readBuildStream(await api(action, { code, port }));
    if (!uploading) {
      if (result.success) compiledCode = code;
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
  if (compiledCode) {
    firmwareStatus.textContent = editor.value === compiledCode ? 'Kompileret og klar til upload.' : 'Kompilér ændringerne før upload.';
    firmwareStatus.removeAttribute('data-error');
  }
  updateControls();
}
window.addEventListener('beforeunload', event => {
  if (editor && savedCode !== editor.value) event.preventDefault();
});
searchButton.addEventListener('click', () => editor.search());
downloadButton.addEventListener('click', downloadSketch);
saveButton.addEventListener('click', saveSketch);
refreshButton.addEventListener('click', refreshPorts);
portSelect.addEventListener('change', updateControls);
compileButton.addEventListener('click', () => runFirmware('compile'));
uploadButton.addEventListener('click', () => runFirmware('upload'));
void loadSketch();
