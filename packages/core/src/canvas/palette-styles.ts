const PALETTE_STYLES = `.fieldnotes-dialog {
  background: var(--fieldnotes-palette-bg, #fff);
  border: 1px solid var(--fieldnotes-palette-border, #d1d5db);
  box-shadow: var(--fieldnotes-palette-shadow, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--fieldnotes-palette-fg, #1a1a1a);
  font: var(--fieldnotes-palette-font, 14px system-ui, sans-serif);
  padding: 16px;
}
.fieldnotes-dialog button, .fieldnotes-dialog input { font: inherit; }
.fieldnotes-dialog button:focus, .fieldnotes-dialog input:focus, .fieldnotes-palette-option--active { background: var(--fieldnotes-palette-active, #e8f0fe); }
.fieldnotes-palette-badge, .fieldnotes-palette-keys { color: var(--fieldnotes-palette-muted, #6b7280); }
.fieldnotes-key { border: 1px solid var(--fieldnotes-palette-border, #d1d5db); border-radius: 3px; padding: 2px 5px; }
.fieldnotes-palette-option mark { background: transparent; color: inherit; font-weight: 600; }
.fieldnotes-help-section { margin-top: 16px; }
.fieldnotes-help-row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; }
.fieldnotes-help-title { margin: 0; }
`;

/** Ensures the palette theme is available in the document or shadow root. */
export function ensurePaletteStyles(root: Node): void {
  const target = root instanceof ShadowRoot ? root : document.head;
  if (target.querySelector('style[data-fieldnotes-palette]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-fieldnotes-palette', '');
  style.textContent = PALETTE_STYLES;
  target.append(style);
}
