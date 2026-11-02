import type { ActionContext, ActionDefinition, ActionsApi } from '../actions/types';
import { resolveActionLabel } from '../actions/action-label';
import type { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import { getElementVisualBounds } from '../elements/element-bounds';
import { SceneSearch } from '../elements/scene-search';
import type { SceneSearchHit } from '../elements/scene-search';
import type { Bounds } from '../core/types';
import type { Camera } from './camera';
import { CameraAnimator } from './camera-animator';
import type { FrameScheduler } from './camera-animator';
import { focusBoard, openDialogShell } from './dialog-shell';
import { LingerOverlay } from './linger-overlay';
import type { LingerOverlayHost } from './linger-overlay';
import { formatBinding, revealView, searchActions } from './palette-model';
import type { PaletteActionRow, PaletteStrings } from './palette-model';
import type { ShortcutsHelpApi } from './shortcuts-help';

export interface PaletteApi {
  /** Opens the palette with `query` in the input (empty by default); re-opening replaces it. */
  open(query?: string): void;
  close(): void;
  isOpen(): boolean;
}

export interface CommandPaletteDeps {
  container: HTMLElement;
  wrapper: HTMLElement;
  actions: ActionsApi;
  getActionContext(): ActionContext;
  getBindings(): Record<string, string[]>;
  store: ElementStore;
  registry: ElementRegistry;
  isLayerVisible(layerId: string): boolean;
  camera: Camera;
  getCanvasSize(): { w: number; h: number };
  overlayHost: LingerOverlayHost;
  stopCameraMotion(): void;
  closeContextMenu(): void;
  help: ShortcutsHelpApi;
  matchShortcut(event: KeyboardEvent): string | null;
  selectionColor: string;
  isMac(): boolean;
  strings: PaletteStrings;
  frames?: FrameScheduler;
  now?: () => number;
}

type PaletteRow = PaletteActionRow | { kind: 'element'; hit: SceneSearchHit };

let paletteId = 0;

export class CommandPalette implements PaletteApi {
  readonly help: ShortcutsHelpApi;
  private readonly search: SceneSearch;
  private readonly id = ++paletteId;
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private rows: PaletteRow[] = [];
  private activeKey: string | null = null;
  private rowSignature: string | null = null;
  private disposeShell: (() => void) | null = null;
  private unsubscribers: (() => void)[] = [];
  private scheduled = false;
  private animator: CameraAnimator | null = null;
  private highlight: LingerOverlay<Bounds> | null = null;
  private highlightedElementId: string | null = null;
  private reduceMotion = false;

  constructor(private readonly deps: CommandPaletteDeps) {
    this.help = deps.help;
    this.search = new SceneSearch(deps.registry);
  }

  open(query = ''): void {
    this.reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.input) {
      this.input.value = query;
      this.render();
      this.input.focus({ preventScroll: true });
      return;
    }
    this.deps.closeContextMenu();
    this.help.close();
    const root = document.createElement('div');
    root.className = 'fieldnotes-palette';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', this.deps.strings.placeholder);
    const input = document.createElement('input');
    input.className = 'fieldnotes-palette-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    input.placeholder = this.deps.strings.placeholder;
    const list = document.createElement('div');
    const listId = `fieldnotes-palette-list-${this.id}`;
    list.className = 'fieldnotes-palette-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    Object.assign(list.style, { maxHeight: '60vh', overflow: 'auto' });
    input.setAttribute('aria-controls', listId);
    const status = document.createElement('div');
    status.className = 'fieldnotes-palette-status';
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    input.value = query;
    input.addEventListener('input', () => this.render());
    root.append(input, list, status);
    this.root = root;
    this.input = input;
    this.list = list;
    this.status = status;
    this.disposeShell = openDialogShell({
      container: this.deps.container,
      root,
      initialFocus: input,
      textInput: input,
      onDismiss: () => this.close(),
      onKeyDown: (event) => this.onKeyDown(event),
    });
    this.subscribe();
    this.render();
  }

  close(): void {
    const root = this.root;
    if (!root) return;
    this.onClose();
    this.unsubscribe();
    this.disposeShell?.();
    this.disposeShell = null;
    this.root = null;
    this.input = null;
    this.list = null;
    this.status = null;
    this.rows = [];
    this.activeKey = null;
    this.rowSignature = null;
    focusBoard(this.deps.wrapper, root);
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  destroy(): void {
    if (this.root) this.unsubscribe();
    this.disposeShell?.();
    this.disposeShell = null;
    this.root = null;
    this.input = null;
    this.list = null;
    this.status = null;
    this.rows = [];
    this.activeKey = null;
    this.rowSignature = null;
    this.animator?.dispose();
    this.animator = null;
    this.highlight?.dispose();
    this.highlight = null;
    this.highlightedElementId = null;
  }

  private subscribe(): void {
    const schedule = () => {
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (this.root) this.render();
      });
    };
    this.unsubscribers = [this.deps.store.onChange(schedule), this.deps.actions.onChange(schedule)];
  }

  private unsubscribe(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.scheduled = false;
  }

  private rowsFor(query: string): PaletteRow[] {
    const context = this.deps.getActionContext();
    const actions = searchActions(this.deps.actions.list(), query, {
      isEnabled: (id) => this.deps.actions.isEnabled(id),
      label: (definition) => resolveActionLabel(definition, context),
      bindings: this.deps.getBindings(),
    });
    if (!query.trim()) return actions;
    const hits = this.search.search(this.deps.store.getAll(), query, {
      filter: (element) => this.deps.isLayerVisible(element.layerId),
    });
    return [...actions, ...hits.map((hit) => ({ kind: 'element' as const, hit }))];
  }

  private render(): void {
    const input = this.input;
    const list = this.list;
    const status = this.status;
    if (!input || !list || !status) return;
    const prior = this.activeKey;
    this.rows = this.rowsFor(input.value);
    if (
      this.highlightedElementId !== null &&
      !this.rows.some((row) => row.kind === 'element' && row.hit.id === this.highlightedElementId)
    ) {
      this.highlight?.remove('find');
      this.highlightedElementId = null;
    }
    const first = this.rows[0];
    if (this.rows.some((row) => this.key(row) === prior)) this.activeKey = prior;
    else if (first) this.activeKey = this.key(first);
    else this.activeKey = null;
    if (!this.activeKey) input.removeAttribute('aria-activedescendant');
    const signature = JSON.stringify([
      this.activeKey,
      this.rows.map((row) =>
        row.kind === 'action'
          ? [
              this.key(row),
              row.label,
              row.keys.map((binding) => formatBinding(binding, this.deps.isMac())),
            ]
          : [this.key(row), row.hit.type, row.hit.text, row.hit.start, row.hit.end],
      ),
    ]);
    if (signature === this.rowSignature) return;
    this.rowSignature = signature;
    const activeKeyChanged = this.activeKey !== prior;
    list.replaceChildren();
    const actions = this.rows.filter((row): row is PaletteActionRow => row.kind === 'action');
    const elements = this.rows.filter(
      (row): row is { kind: 'element'; hit: SceneSearchHit } => row.kind === 'element',
    );
    if (actions.length) {
      list.append(this.group('actions', this.deps.strings.actions, actions, activeKeyChanged));
    }
    if (elements.length) {
      list.append(this.group('board', this.deps.strings.board, elements, activeKeyChanged));
    }
    if (!this.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'fieldnotes-palette-empty';
      empty.textContent = this.deps.strings.noResults;
      list.append(empty);
    }
    status.textContent = this.rows.length ? String(this.rows.length) : this.deps.strings.noResults;
  }

  private group(
    kind: 'actions' | 'board',
    title: string,
    rows: readonly PaletteRow[],
    scrollActive: boolean,
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'fieldnotes-palette-group';
    group.setAttribute('role', 'group');
    const heading = document.createElement('div');
    heading.className = 'fieldnotes-palette-group-title';
    heading.id = `fieldnotes-palette-title-${this.id}-${kind}`;
    heading.setAttribute('role', 'presentation');
    heading.textContent = title;
    group.setAttribute('aria-labelledby', heading.id);
    group.append(heading);
    for (const row of rows) group.append(this.option(row, scrollActive));
    return group;
  }

  private option(row: PaletteRow, scrollActive: boolean): HTMLElement {
    const option = document.createElement('div');
    const key = this.key(row);
    const selected = key === this.activeKey;
    option.className = 'fieldnotes-palette-option';
    if (selected) option.classList.add('fieldnotes-palette-option--active');
    option.id = `fieldnotes-palette-option-${this.id}-${key}`;
    option.dataset.key = row.kind === 'action' ? row.id : row.hit.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selected));
    option.addEventListener('click', () => this.commit(row));
    if (row.kind === 'action') {
      const label = document.createElement('span');
      label.textContent = row.label;
      const keys = document.createElement('span');
      keys.className = 'fieldnotes-palette-keys';
      for (const binding of row.keys) {
        const kbd = document.createElement('kbd');
        kbd.className = 'fieldnotes-key';
        kbd.textContent = formatBinding(binding, this.deps.isMac());
        keys.append(kbd);
      }
      option.append(label, keys);
    } else {
      this.appendHit(option, row.hit);
    }
    if (selected) {
      this.input?.setAttribute('aria-activedescendant', option.id);
      if (scrollActive) option.scrollIntoView?.({ block: 'nearest' });
    }
    return option;
  }

  private appendHit(option: HTMLElement, hit: SceneSearchHit): void {
    let lineStart = 0;
    let lineEnd = hit.text.length;
    for (const boundary of hit.text.matchAll(/\r?\n/gu)) {
      if (hit.start <= boundary.index) {
        lineEnd = boundary.index;
        break;
      }
      lineStart = boundary.index + boundary[0].length;
    }
    const characters = Array.from(hit.text.slice(lineStart, lineEnd));
    const matchStart = Math.min(Math.max(hit.start - lineStart, 0), lineEnd - lineStart);
    const matchEnd = Math.min(Math.max(hit.end - lineStart, matchStart), lineEnd - lineStart);
    let start = 0;
    let startOffset = 0;
    for (const character of characters) {
      if (startOffset >= matchStart) break;
      startOffset += character.length;
      start += 1;
    }
    let end = start;
    let endOffset = startOffset;
    for (const character of characters.slice(start)) {
      if (endOffset >= matchEnd) break;
      endOffset += character.length;
      end += 1;
    }
    const windowStart = Math.max(start - 40, 0);
    const windowEnd = Math.min(windowStart + 80, characters.length);
    const visibleStart = Math.max(start, windowStart);
    const visibleEnd = Math.min(end, windowEnd);
    if (windowStart > 0) option.append(document.createTextNode('…'));
    option.append(document.createTextNode(characters.slice(windowStart, visibleStart).join('')));
    const mark = document.createElement('mark');
    mark.textContent = characters.slice(visibleStart, visibleEnd).join('');
    option.append(mark, document.createTextNode(characters.slice(visibleEnd, windowEnd).join('')));
    if (windowEnd < characters.length) option.append(document.createTextNode('…'));
    const badge = document.createElement('span');
    badge.className = 'fieldnotes-palette-badge';
    badge.textContent = this.deps.strings.types[hit.type] ?? hit.type;
    option.append(badge);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (
      (event.ctrlKey || event.metaKey || event.altKey) &&
      this.deps.matchShortcut(event) === 'palette.open'
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = this.rows.findIndex((row) => this.key(row) === this.activeKey);
      const next =
        event.key === 'ArrowDown'
          ? Math.min(index + 1, this.rows.length - 1)
          : Math.max(index - 1, 0);
      const row = this.rows[next];
      if (row) {
        this.activeKey = this.key(row);
        this.onActiveRow(row);
        this.render();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = this.rows.find((candidate) => this.key(candidate) === this.activeKey);
      if (row) this.commit(row);
    }
  }

  private commit(row: PaletteRow): void {
    if (row.kind === 'action') {
      this.close();
      this.deps.actions.run(row.id, { source: 'menu' });
      return;
    }
    this.onElementChosen(row.hit);
    this.close();
  }

  private key(row: PaletteRow): string {
    return row.kind === 'action' ? `action:${row.id}` : `element:${row.hit.id}`;
  }

  private onActiveRow(row: PaletteRow): void {
    if (row.kind === 'element') {
      this.reveal(row.hit);
      return;
    }
    this.highlight?.remove('find');
    this.highlightedElementId = null;
  }

  private onElementChosen(hit: SceneSearchHit): void {
    this.reveal(hit);
  }

  private onClose(): void {
    this.highlight?.linger('find');
    this.highlightedElementId = null;
  }

  private reveal(hit: SceneSearchHit): void {
    const element = this.deps.store.getById(hit.id);
    if (!element) {
      this.highlight?.remove('find');
      this.highlightedElementId = null;
      return;
    }
    const bounds = getElementVisualBounds(element, this.deps.registry);
    if (!bounds) {
      this.highlight?.remove('find');
      this.highlightedElementId = null;
      return;
    }
    this.deps.stopCameraMotion();
    const size = this.deps.getCanvasSize();
    const view = revealView(bounds, this.deps.camera.getVisibleRect(size.w, size.h));
    if (this.animator === null) {
      this.animator = new CameraAnimator(this.deps.wrapper, this.deps.camera, {
        getCanvasSize: this.deps.getCanvasSize,
        interactive: true,
        frames: this.deps.frames,
        now: this.deps.now,
      });
    }
    if (this.reduceMotion) this.animator.jumpTo(view);
    else this.animator.animateTo(view);
    if (this.highlight === null) {
      this.highlight = new LingerOverlay(
        this.deps.overlayHost,
        { holdMs: 1500, fadeMs: 400 },
        (ctx, entry, alpha) => {
          const pad = 4 / this.deps.camera.zoom;
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = this.deps.selectionColor;
          ctx.lineWidth = 2 / this.deps.camera.zoom;
          ctx.strokeRect(entry.x - pad, entry.y - pad, entry.w + pad * 2, entry.h + pad * 2);
        },
        this.deps.now,
      );
    }
    this.highlight.set('find', bounds);
    this.highlightedElementId = hit.id;
  }
}

export function createPaletteActions(
  palette: PaletteApi,
  help: ShortcutsHelpApi,
): ActionDefinition[] {
  return [
    {
      id: 'palette.open',
      label: 'Command palette',
      keywords: ['search', 'find', 'commands', 'go to'],
      shortcut: ['mod+k'],
      enabled: () => !palette.isOpen(),
      perform: () => palette.open(),
    },
    {
      id: 'palette.help',
      label: 'Keyboard shortcuts',
      keywords: ['help', 'keys', 'bindings', 'shortcuts'],
      shortcut: ['?'],
      allowShift: true,
      enabled: () => !help.isOpen(),
      perform: () => help.open(),
    },
  ];
}
