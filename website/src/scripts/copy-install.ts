const COPIED_MS = 2000;

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-install]')) {
  const chip = button.querySelector('[data-copy-chip]');
  const text = button.querySelector('[data-copy-command]');
  const command = button.dataset.copyInstall;
  if (chip === null || text === null || command === undefined) continue;
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(command).then(
      () => {
        chip.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(() => (chip.textContent = 'Copy'), COPIED_MS);
      },
      // Clipboard refused: select the command so the visitor can copy it by hand.
      () => getSelection()?.selectAllChildren(text),
    );
  });
}
