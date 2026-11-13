import type { KeyboardActions } from './keyboard-actions';
import { encodeClipboard, FIELDNOTES_CLIPBOARD_TYPE } from './clipboard-codec';

export interface ClipboardBridgeDeps {
  keyboardActions: KeyboardActions;
  document: Document;
}

/** Writes copied elements to the system clipboard through the native `copy` event. */
export class ClipboardBridge {
  private pending = false;

  constructor(private readonly deps: ClipboardBridgeDeps) {}

  /** True while `copy()` runs `execCommand('copy')`, so its event is handled from any target. */
  get pendingWrite(): boolean {
    return this.pending;
  }

  copy(): void {
    const ka = this.deps.keyboardActions;
    if (ka.copyableElements().length === 0) return;
    ka.copy();
    this.pending = true;
    try {
      // Missing or refused execCommand leaves the memory clipboard as the only copy.
      this.deps.document.execCommand?.('copy');
    } finally {
      this.pending = false;
    }
  }

  cut(): void {
    this.copy();
    this.deps.keyboardActions.deleteSelected();
  }

  handleCopy(event: ClipboardEvent, allowed: boolean, cut: boolean): boolean {
    if (!allowed && !this.pending) return false;
    const ka = this.deps.keyboardActions;
    const elements = ka.copyableElements();
    if (elements.length === 0) return false;
    const data = event.clipboardData;
    if (!data) return false;
    ka.copy();
    const payload = encodeClipboard(elements);
    data.setData(FIELDNOTES_CLIPBOARD_TYPE, payload.vendor);
    data.setData('text/html', payload.html);
    data.setData('text/plain', payload.text);
    event.preventDefault();
    if (cut) ka.deleteSelected();
    return true;
  }

  /** Claims `beforecopy`/`beforecut` so WebKit fires the event without a DOM selection. */
  handleBeforeCopy(event: Event, allowed: boolean): void {
    if ((allowed || this.pending) && this.deps.keyboardActions.copyableElements().length > 0) {
      event.preventDefault();
    }
  }
}
