import type { ArrowElement } from './types';
import type { ElementStore } from './element-store';
import type { HistoryRecorder } from '../history/history-recorder';
import { getArrowMidpoint } from './arrow-geometry';

export interface ArrowLabelEditStart {
  arrow: ArrowElement;
  layer: HTMLElement;
  store: ElementStore;
  recorder: HistoryRecorder;
  onDone: () => void;
}

export class ArrowLabelEditor {
  private input: HTMLInputElement | null = null;
  private done = false;

  get isEditing(): boolean {
    return this.input !== null;
  }

  startEditing(start: ArrowLabelEditStart): void {
    if (this.input) this.cleanup();
    const { arrow, layer, store, recorder, onDone } = start;
    const mid = getArrowMidpoint(arrow.from, arrow.to, arrow.bend);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = arrow.label ?? '';
    Object.assign(input.style, {
      position: 'absolute',
      left: `${mid.x}px`,
      top: `${mid.y}px`,
      transform: 'translate(-50%, -50%)',
      // domLayer is pointer-events:none; the input must opt back in to receive taps/clicks.
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
      padding: '2px 6px',
      border: '1px solid #2196F3',
      borderRadius: '4px',
      background: '#ffffff',
      color: '#1a1a1a',
      outline: 'none',
      minWidth: '40px',
    });

    this.done = false;

    const commit = (): void => {
      if (this.done) return;
      this.done = true;
      const next = input.value.trim() || undefined;
      if (next !== arrow.label) {
        recorder.begin();
        store.update(arrow.id, { label: next });
        recorder.commit();
      }
      this.cleanup();
      onDone();
    };

    const cancel = (): void => {
      if (this.done) return;
      this.done = true;
      this.cleanup();
      onDone();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);

    layer.appendChild(input);
    this.input = input;
    input.focus();
    input.select();
  }

  private cleanup(): void {
    if (this.input) {
      this.input.remove();
      this.input = null;
    }
  }
}
