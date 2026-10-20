const COPIED_MS = 2000;

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-install]')) {
  const chip = button.querySelector('[data-copy-chip]');
  const command = button.dataset.copyInstall;
  if (chip === null || command === undefined) continue;
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(command);
    chip.textContent = 'Copied';
    clearTimeout(timer);
    timer = setTimeout(() => (chip.textContent = 'Copy'), COPIED_MS);
  });
}
