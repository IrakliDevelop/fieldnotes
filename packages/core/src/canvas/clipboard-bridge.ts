import type { Point } from '../core/types';
import type { ElementRegistry } from '../elements/element-registry';
import type { CanvasElement } from '../elements/types';
import type { KeyboardActions } from './keyboard-actions';
import { isPasteLink, normalizeLink } from '../elements/link';
import {
  decodeClipboard,
  encodeClipboard,
  FIELDNOTES_CLIPBOARD_TYPE,
  hasClipboardMarker,
} from './clipboard-codec';

/** The viewport side of a paste: the host hook and the inserters that place content. */
export interface ClipboardHost {
  elementRegistry: ElementRegistry;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- undefined keeps the host-owns-it contract
  onPaste?: (event: ClipboardEvent, world: Point) => boolean | void;
  claimsFile: (file: File, kind: 'paste') => boolean;
  insertElements: (elements: CanvasElement[], anchor: Point) => void;
  insertFiles: (files: File[], anchor: Point, kind: 'paste') => boolean;
  insertText: (text: string, anchor: Point, link?: string) => void;
}

export interface ClipboardBridgeDeps {
  keyboardActions: KeyboardActions;
  document: Document;
  /** The board wrapper: page text selected outside it keeps native copy and cut. */
  element: HTMLElement;
  /** True when the host disabled the shortcut for this action id. */
  isDisabled: (action: string) => boolean;
  canInsertNow: () => boolean;
  host: ClipboardHost;
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
    if (!this.claims(allowed, cut)) return false;
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

  /** Routes a paste: envelope, image files, a link line, plain text, else the memory clipboard. */
  paste(event: ClipboardEvent, anchor: Point): void {
    if (this.deps.isDisabled('edit.paste')) return;
    const data = event.clipboardData;
    if (!data) {
      this.memoryPaste(event, anchor);
      return;
    }
    const payload = {
      vendor: data.getData(FIELDNOTES_CLIPBOARD_TYPE),
      html: data.getData('text/html'),
      text: data.getData('text/plain'),
    };
    const files: File[] = [];
    for (const item of data.items) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (file) files.push(file);
    }
    const marker = hasClipboardMarker(payload);
    const line = payload.text.trim();
    const { host } = this.deps;
    const claimed = files.filter((f) => host.claimsFile(f, 'paste'));
    if (!marker && claimed.length === 0 && line.length === 0) {
      this.memoryPaste(event, anchor);
      return;
    }
    if (host.onPaste && host.onPaste(event, anchor) !== false) return;
    event.preventDefault();
    if (!this.deps.canInsertNow()) return;
    if (marker) {
      // A marker ends the paste even when decoding fails: never reinterpret it as text.
      const elements = decodeClipboard(payload, host.elementRegistry);
      const ka = this.deps.keyboardActions;
      if (elements) host.insertElements(elements, anchor);
      // An over-cap envelope copied in this tab still pastes from the memory clipboard.
      else if (ka.hasClipboard()) ka.paste();
      return;
    }
    if (claimed.length > 0) {
      host.insertFiles(claimed, anchor, 'paste');
      return;
    }
    if (!line.includes('\n') && isPasteLink(line)) {
      host.insertText(line, anchor, normalizeLink(line) ?? undefined);
      return;
    }
    host.insertText(payload.text, anchor);
  }

  /** Claims `beforecopy`/`beforecut` so WebKit fires the event without a DOM selection. */
  handleBeforeCopy(event: Event, allowed: boolean): void {
    const claimed = this.claims(allowed, event.type === 'beforecut');
    if (claimed && this.deps.keyboardActions.copyableElements().length > 0) {
      event.preventDefault();
    }
  }

  private memoryPaste(event: ClipboardEvent, anchor: Point): void {
    const ka = this.deps.keyboardActions;
    const { onPaste } = this.deps.host;
    if (ka.hasClipboard() && onPaste && onPaste(event, anchor) !== false) return;
    ka.paste();
  }

  /** A native copy or cut is ours unless disabled or page text outside the board is selected. */
  private claims(allowed: boolean, cut: boolean): boolean {
    if (this.pending) return true;
    if (!allowed || this.deps.isDisabled(cut ? 'edit.cut' : 'edit.copy')) return false;
    const selection = this.deps.document.getSelection();
    return !selection || selection.isCollapsed || this.deps.element.contains(selection.anchorNode);
  }
}
