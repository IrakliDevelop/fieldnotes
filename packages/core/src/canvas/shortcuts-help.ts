import type { ActionContext, ActionsApi, ActionDefinition } from '../actions/types';
import { focusBoard, openDialogShell } from './dialog-shell';
import { buildHelpSections, formatBinding } from './palette-model';
import type { PaletteStrings } from './palette-model';

export interface ShortcutsHelpApi {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface ShortcutsHelpDeps {
  container: HTMLElement;
  wrapper: HTMLElement;
  actions: ActionsApi;
  getActionContext(): ActionContext;
  getBindings(): Record<string, string[]>;
  matchShortcut(event: KeyboardEvent): string | null;
  isMac(): boolean;
  strings: PaletteStrings;
  closeOthers(): void;
}

function label(definition: ActionDefinition, context: ActionContext): string {
  return typeof definition.label === 'string' ? definition.label : definition.label(context);
}

export class ShortcutsHelp implements ShortcutsHelpApi {
  private disposeShell: (() => void) | null = null;
  private root: HTMLDivElement | null = null;

  constructor(private readonly deps: ShortcutsHelpDeps) {}

  open(): void {
    if (this.root) return;
    this.deps.closeOthers();
    const root = document.createElement('div');
    root.className = 'fieldnotes-help';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', this.deps.strings.helpTitle);
    Object.assign(root.style, { maxHeight: '80vh', overflow: 'auto' });
    const title = document.createElement('h2');
    title.className = 'fieldnotes-help-title';
    title.textContent = this.deps.strings.helpTitle;
    const close = document.createElement('button');
    close.className = 'fieldnotes-help-close';
    close.type = 'button';
    close.textContent = this.deps.strings.close;
    close.addEventListener('click', () => this.close());
    root.append(title, close);
    const context = this.deps.getActionContext();
    for (const section of buildHelpSections(
      this.deps.actions.list(),
      this.deps.getBindings(),
      (definition) => label(definition, context),
      this.deps.strings,
    )) {
      const sectionNode = document.createElement('section');
      sectionNode.className = 'fieldnotes-help-section';
      const heading = document.createElement('h3');
      heading.textContent = section.title;
      sectionNode.append(heading);
      for (const row of section.rows) {
        const rowNode = document.createElement('div');
        rowNode.className = 'fieldnotes-help-row';
        const rowLabel = document.createElement('span');
        rowLabel.textContent = row.label;
        rowNode.append(rowLabel);
        for (const binding of row.keys) {
          const key = document.createElement('kbd');
          key.className = 'fieldnotes-key';
          key.textContent = formatBinding(binding, this.deps.isMac());
          rowNode.append(key);
        }
        sectionNode.append(rowNode);
      }
      root.append(sectionNode);
    }
    this.root = root;
    this.disposeShell = openDialogShell({
      container: this.deps.container,
      root,
      initialFocus: root,
      onDismiss: () => this.close(),
      onKeyDown: (event) => {
        if (
          (event.ctrlKey || event.metaKey || event.altKey) &&
          this.deps.matchShortcut(event) === 'palette.open'
        ) {
          event.preventDefault();
          return;
        }
        if (event.key === '?') this.close();
      },
    });
  }

  close(): void {
    const root = this.root;
    if (!root) return;
    this.disposeShell?.();
    this.disposeShell = null;
    this.root = null;
    focusBoard(this.deps.wrapper, root);
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  destroy(): void {
    if (!this.root) return;
    this.disposeShell?.();
    this.disposeShell = null;
    this.root = null;
  }
}
