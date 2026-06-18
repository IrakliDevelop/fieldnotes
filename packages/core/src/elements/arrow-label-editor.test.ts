// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ArrowLabelEditor } from './arrow-label-editor';
import { ElementStore } from './element-store';
import { HistoryStack } from '../history/history-stack';
import { HistoryRecorder } from '../history/history-recorder';
import { createArrow } from './element-factory';

function setup() {
  const store = new ElementStore();
  const stack = new HistoryStack();
  const recorder = new HistoryRecorder(store, stack);
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  return { store, stack, recorder, layer, editor: new ArrowLabelEditor() };
}

function start(
  env: ReturnType<typeof setup>,
  arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }),
) {
  env.recorder.pause();
  env.store.add(arrow);
  env.recorder.resume();
  env.editor.startEditing({
    arrow,
    layer: env.layer,
    store: env.store,
    recorder: env.recorder,
    onDone: () => undefined,
  });
  return { arrow, input: env.layer.querySelector('input') };
}

function getLabel(env: ReturnType<typeof setup>, id: string): string | undefined {
  const el = env.store.getById(id);
  return el && 'label' in el ? (el.label as string | undefined) : undefined;
}

describe('ArrowLabelEditor', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('opens a focused input with the current label', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, label: 'old' });
    const { input } = start(env, arrow);
    expect(input).not.toBeNull();
    expect(input?.value).toBe('old');
  });

  it('commits a new label on Enter as one undo step', () => {
    const { arrow, input } = start(env);
    if (!input) throw new Error('input not rendered');
    input.value = 'flows';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(getLabel(env, arrow.id)).toBe('flows');
    expect(env.stack.undoCount).toBe(1);
    expect(env.layer.querySelector('input')).toBeNull();
  });

  it('commits on blur', () => {
    const { arrow, input } = start(env);
    if (!input) throw new Error('input not rendered');
    input.value = 'x';
    input.dispatchEvent(new Event('blur'));
    expect(getLabel(env, arrow.id)).toBe('x');
  });

  it('cancels on Escape (no store change, no history)', () => {
    const { arrow, input } = start(env);
    if (!input) throw new Error('input not rendered');
    input.value = 'nope';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(getLabel(env, arrow.id)).toBeUndefined();
    expect(env.stack.undoCount).toBe(0);
  });

  it('clears the label to undefined when committed empty', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, label: 'old' });
    const { input } = start(env, arrow);
    if (!input) throw new Error('input not rendered');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(getLabel(env, arrow.id)).toBeUndefined();
  });

  it('records no history when the label is unchanged', () => {
    const arrow = createArrow({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, label: 'same' });
    const { input } = start(env, arrow);
    if (!input) throw new Error('input not rendered');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(env.stack.undoCount).toBe(0);
  });

  it('does not double-commit when Enter is followed by blur', () => {
    const { arrow, input } = start(env);
    if (!input) throw new Error('input not rendered');
    input.value = 'once';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // Enter removes the input, which fires blur → commit must short-circuit on `done`.
    input.dispatchEvent(new Event('blur'));
    expect(getLabel(env, arrow.id)).toBe('once');
    expect(env.stack.undoCount).toBe(1);
  });
});
