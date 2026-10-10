import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'preact/hooks';

const lightHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: '#111827' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: tags.url, color: '#2563eb' },
  { tag: tags.monospace, color: '#be123c' },
  { tag: tags.quote, color: '#5b6472', fontStyle: 'italic' },
  { tag: tags.list, color: '#7c3aed' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.processingInstruction, color: '#94a3b8' },
  { tag: tags.contentSeparator, color: '#94a3b8' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: '#f3f4f6' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#60a5fa', textDecoration: 'underline' },
  { tag: tags.url, color: '#60a5fa' },
  { tag: tags.monospace, color: '#f0abfc' },
  { tag: tags.quote, color: '#a3acbb', fontStyle: 'italic' },
  { tag: tags.list, color: '#c4b5fd' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.processingInstruction, color: '#6f7887' },
  { tag: tags.contentSeparator, color: '#6f7887' },
]);

function themeFor(dark: boolean) {
  return EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: 'var(--text)', height: '100%' },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        fontSize: '13px',
        lineHeight: '1.65',
        overflow: 'auto',
      },
      '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
      '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-faint)', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
      '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--accent-soft)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
      },
      '.cm-panels': { backgroundColor: 'var(--bg-sunken)', color: 'var(--text)' },
      '.cm-panels input, .cm-panels button': { color: 'var(--text)' },
      '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.35)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.6)' },
    },
    { dark },
  );
}

export interface EditorApi {
  setDoc(value: string): void;
  getDoc(): string;
  wrap(before: string, after: string, placeholder?: string): void;
  insert(text: string): { from: number; to: number };
  replace(from: number, to: number, text: string): void;
  insertBlock(text: string): void;
  focus(): void;
}

interface CodeEditorProps {
  initialValue: string;
  onChange(value: string): void;
  onCursorLine(line: number): void;
  onDropFiles(files: File[]): void;
  dark: boolean;
  apiRef: { current: EditorApi | null };
}

function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith('image/')) out.push(file);
  }
  if (out.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
  }
  return out;
}

export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeSlot = useRef(new Compartment());
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const dark = latest.current.dark;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: latest.current.initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          markdown(),
          cmPlaceholder('开始写作…'),
          EditorState.tabSize.of(2),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          themeSlot.current.of([
            themeFor(dark),
            syntaxHighlighting(dark ? darkHighlight : lightHighlight),
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              latest.current.onCursorLine(update.state.doc.lineAt(head).number);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    const api: EditorApi = {
      setDoc(value) {
        if (value === view.state.doc.toString()) return;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      },
      getDoc: () => view.state.doc.toString(),
      wrap(before, after, placeholderText = '') {
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        const inner = selected === '' ? placeholderText : selected;
        const insert = `${before}${inner}${after}`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + before.length, head: from + before.length + inner.length },
        });
        view.focus();
      },
      insert(text) {
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        });
        view.focus();
        return { from: pos, to: pos + text.length };
      },
      replace(from, to, text) {
        const max = view.state.doc.length;
        view.dispatch({ changes: { from: Math.min(from, max), to: Math.min(to, max), insert: text } });
      },
      insertBlock(text) {
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const payload = `${line.text.trim() === '' ? '' : '\n'}${text}\n`;
        view.dispatch({
          changes: { from: pos, insert: payload },
          selection: { anchor: pos + payload.length },
        });
        view.focus();
      },
      focus: () => view.focus(),
    };
    latest.current.apiRef.current = api;

    const dom = view.dom;
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesOf(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      latest.current.onDropFiles(files);
    };
    const onDrop = (event: DragEvent) => {
      const files = imageFilesOf(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      latest.current.onDropFiles(files);
    };
    const onDragOver = (event: DragEvent) => {
      if (imageFilesOf(event.dataTransfer).length > 0) event.preventDefault();
    };
    dom.addEventListener('paste', onPaste);
    dom.addEventListener('drop', onDrop);
    dom.addEventListener('dragover', onDragOver);

    return () => {
      dom.removeEventListener('paste', onPaste);
      dom.removeEventListener('drop', onDrop);
      dom.removeEventListener('dragover', onDragOver);
      view.destroy();
      viewRef.current = null;
      if (latest.current.apiRef.current === api) latest.current.apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeSlot.current.reconfigure([
        themeFor(props.dark),
        syntaxHighlighting(props.dark ? darkHighlight : lightHighlight),
      ]),
    });
  }, [props.dark]);

  return <div class="editor-host" ref={hostRef} />;
}