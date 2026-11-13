import { normalizeLink } from '../elements/link';
import { focusBoard, openDialogShell } from './dialog-shell';

export interface LinkPromptDeps {
  container: HTMLElement;
  wrapper: HTMLElement;
  initialValue: string;
  onSubmit: (link: string | null) => void;
  onClose: () => void;
}

/** Opens the link text prompt; an empty value submits null. Returns close. */
export function openLinkPrompt(deps: LinkPromptDeps): () => void {
  const root = document.createElement('div');
  root.className = 'fieldnotes-palette';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Link');
  const input = document.createElement('input');
  input.className = 'fieldnotes-palette-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'https://';
  input.value = deps.initialValue;
  root.append(input);

  let disposeShell: (() => void) | null = null;
  const close = () => {
    if (disposeShell === null) return;
    disposeShell();
    disposeShell = null;
    focusBoard(deps.wrapper, root);
    deps.onClose();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') {
      input.removeAttribute('aria-invalid');
      return;
    }
    event.preventDefault();
    const value = input.value.trim();
    if (value === '') {
      deps.onSubmit(null);
      close();
      return;
    }
    const link = normalizeLink(value);
    if (link === null) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    deps.onSubmit(link);
    close();
  };
  disposeShell = openDialogShell({
    container: deps.container,
    root,
    initialFocus: input,
    textInput: input,
    onKeyDown,
    onDismiss: close,
  });
  return close;
}
