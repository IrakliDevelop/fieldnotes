const TOAST_MS = 3000;

/** Returns a function that shows `message` in `root` for 3 s, replacing any current toast. */
export function createToaster(root: HTMLElement): (message: string) => void {
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message) => {
    if (root.textContent === message) return;
    clearTimeout(timer);
    const toast = document.createElement('div');
    toast.className = 'island toast';
    toast.textContent = message;
    root.replaceChildren(toast);
    timer = setTimeout(() => root.replaceChildren(), TOAST_MS);
  };
}
