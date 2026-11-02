import { ensurePaletteStyles } from './palette-styles';

export interface DialogShellOptions {
  container: HTMLElement;
  root: HTMLElement;
  initialFocus: HTMLElement;
  /** The one element whose mousedown/pointerdown keeps the default (caret placement). */
  textInput?: HTMLElement;
  onKeyDown(event: KeyboardEvent): void;
  onDismiss(): void;
}

function pathIncludes(event: Event, node: Node): boolean {
  return event.composedPath().includes(node);
}

function isInsideDialog(event: Event): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof Element && node.classList.contains('fieldnotes-dialog'));
}

/** Mounts `root`, traps focus, isolates its keys, dismisses on Escape or an outside pointerdown. Returns dispose. */
export function openDialogShell(options: DialogShellOptions): () => void {
  const { container, root, initialFocus, textInput, onKeyDown, onDismiss } = options;
  const doc = container.ownerDocument;
  root.tabIndex = -1;
  root.classList.add('fieldnotes-dialog');
  Object.assign(root.style, {
    position: 'fixed',
    top: '10vh',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(560px, 92vw)',
    zIndex: '2147483647',
  });
  ensurePaletteStyles(container.getRootNode());
  container.append(root);
  initialFocus.focus({ preventScroll: true });

  const dismiss = () => onDismiss();
  const onRootKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length) {
        const index = focusable.indexOf(doc.activeElement as HTMLElement);
        const next = event.shiftKey
          ? index <= 0
            ? focusable.length - 1
            : index - 1
          : index === focusable.length - 1
            ? 0
            : index + 1;
        focusable[next]?.focus({ preventScroll: true });
      }
      event.preventDefault();
      return;
    }
    onKeyDown(event);
  };
  const onRootPointer = (event: MouseEvent | PointerEvent) => {
    if (event.target !== textInput) event.preventDefault();
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isInsideDialog(event)) return;
    const target = event.target;
    if (target !== doc.body && target !== null && !pathIncludes(event, container)) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!pathIncludes(event, root)) dismiss();
  };
  root.addEventListener('keydown', onRootKeyDown);
  root.addEventListener('mousedown', onRootPointer);
  root.addEventListener('pointerdown', onRootPointer);
  doc.addEventListener('keydown', onDocumentKeyDown, true);
  const timer = setTimeout(() => doc.addEventListener('pointerdown', onDocumentPointerDown), 0);
  return () => {
    root.removeEventListener('keydown', onRootKeyDown);
    root.removeEventListener('mousedown', onRootPointer);
    root.removeEventListener('pointerdown', onRootPointer);
    doc.removeEventListener('keydown', onDocumentKeyDown, true);
    clearTimeout(timer);
    doc.removeEventListener('pointerdown', onDocumentPointerDown);
    root.remove();
  };
}

/** Focuses the board after a dialog closes; blurs the dialog when the wrapper is not focusable. */
export function focusBoard(wrapper: HTMLElement, root: HTMLElement): void {
  wrapper.focus({ preventScroll: true });
  const active = root.ownerDocument.activeElement;
  if ((active === root || root.contains(active)) && active instanceof HTMLElement) active.blur();
}
