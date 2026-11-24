import { basicSetup, EditorView } from 'codemirror';
import { completeFromList } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { openSearchPanel } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const arduinoCompletions = completeFromList([
  { label: 'Serial', type: 'variable', detail: 'USB serial port' },
  { label: 'Wire', type: 'variable', detail: 'IÂ²C' },
  { label: 'MachineControl_DigitalInputs', type: 'variable', detail: 'Portenta' },
  { label: 'setup', type: 'function' },
  { label: 'loop', type: 'function' },
  { label: 'millis', type: 'function' },
  { label: 'delay', type: 'function' },
  { label: 'pinMode', type: 'function' },
  { label: 'digitalRead', type: 'function' },
  { label: 'digitalWrite', type: 'function' },
  { label: 'HIGH', type: 'constant' },
  { label: 'LOW', type: 'constant' },
  { label: 'INPUT', type: 'constant' },
  { label: 'OUTPUT', type: 'constant' },
  ...Array.from({ length: 8 }, (_, index) => ({ label: `DIN_READ_CH_PIN_0${index}`, type: 'constant' })),
]);

const editorTheme = EditorView.theme({
  '&': { color: 'var(--machine-ink)', backgroundColor: 'var(--machine)', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--machine-ink)', paddingBlock: '8px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-gutters, .cm-panels': { backgroundColor: 'var(--machine-plate)', color: 'var(--machine-muted)', borderColor: 'var(--machine-line)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--machine-grid)' },
  '.cm-searchMatch, .cm-selectionMatch, .cm-matchingBracket': { backgroundColor: 'var(--machine-occupied)' },
  '.cm-tooltip': { backgroundColor: 'var(--machine-plate)', borderColor: 'var(--machine-line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--machine-occupied)' },
  '.cm-button, .cm-textfield': { color: 'var(--machine-ink)', background: 'var(--machine)', borderColor: 'var(--machine-line)' },
}, { dark: true });

const codeColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.character], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--code-type)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--machine-muted)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))], color: 'var(--code-type)' },
]);

function reportCursor(state, report) {
  const anchor = state.selection.main.head;
  const line = state.doc.lineAt(anchor);
  report(line.number, anchor - line.from + 1);
}

export function createArduinoEditor({ parent, doc, onChange, onCursor, onSave, onCompile }) {
  const editable = new Compartment();
  let locked = false;
  const view = new EditorView({
    parent,
    doc,
    extensions: [
      Prec.highest(keymap.of([
        { key: 'Mod-s', run: () => { onSave(); return true; } },
        { key: 'Mod-Enter', run: () => { onCompile(); return true; } },
      ])),
      basicSetup,
      cpp(),
      cppLanguage.data.of({ autocomplete: arduinoCompletions }),
      syntaxHighlighting(codeColors),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      keymap.of([indentWithTab]),
      lintGutter(),
      editorTheme,
      EditorView.contentAttributes.of({ 'aria-labelledby': 'sketch-label', spellcheck: 'false' }),
      editable.of([]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange();
        if (update.docChanged || update.selectionSet) reportCursor(update.state, onCursor);
      }),
    ],
  });
  reportCursor(view.state, onCursor);

  return {
    get value() { return view.state.doc.toString(); },
    setReadOnly(readOnly) {
      if (readOnly === locked) return;
      locked = readOnly;
      view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    },
    search() { openSearchPanel(view); },
    showDiagnostics(lines) {
      const diagnostics = [];
      for (const text of lines) {
        const match = /\bDemo\.ino:(\d+)(?::(\d+))?:\s*(fatal error|error|warning):\s*(.*)/.exec(text);
        if (!match || Number(match[1]) < 1 || Number(match[1]) > view.state.doc.lines) continue;
        const line = view.state.doc.line(Number(match[1]));
        const from = Math.min(line.to, line.from + Math.max(0, Number(match[2] ?? 1) - 1));
        diagnostics.push({ from, to: Math.min(line.to, from + 1), message: match[4], severity: match[3] === 'warning' ? 'warning' : 'error' });
      }
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
  };
}
