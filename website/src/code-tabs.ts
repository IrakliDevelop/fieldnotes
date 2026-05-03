export function initCodeTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.code-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset['codetab'];
      if (!key) return;

      document.querySelectorAll<HTMLButtonElement>('.code-tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
      });

      document.querySelectorAll<HTMLElement>('.code-body[data-code]').forEach((body) => {
        body.style.display = body.dataset['code'] === key ? 'block' : 'none';
      });
    });
  });
}

export function initClipboard(): void {
  const el = document.getElementById('install');
  const hint = document.getElementById('copy-hint');
  if (!el || !hint) return;

  el.addEventListener('click', () => {
    navigator.clipboard?.writeText('npm install @fieldnotes/core');
    hint.textContent = 'copied ✓';
    setTimeout(() => {
      hint.textContent = 'copy';
    }, 1400);
  });
}
