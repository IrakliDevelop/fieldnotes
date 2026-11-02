const PALETTE_STYLES = `.fieldnotes-dialog {
  --fieldnotes-palette-bg: var(--fieldnotes-surface, #fff);
  --fieldnotes-palette-fg: var(--fieldnotes-text, #1f2937);
  --fieldnotes-palette-muted: var(--fieldnotes-muted, #6b7280);
  --fieldnotes-palette-border: var(--fieldnotes-border, #d1d5db);
  --fieldnotes-palette-active: var(--fieldnotes-active, #e5e7eb);
  --fieldnotes-palette-shadow: var(--fieldnotes-shadow, 0 12px 32px rgb(0 0 0 / 18%));
  --fieldnotes-palette-font: var(--fieldnotes-font, system-ui, sans-serif);
  background: var(--fieldnotes-palette-bg);
  border: 1px solid var(--fieldnotes-palette-border);
  box-shadow: var(--fieldnotes-palette-shadow);
  color: var(--fieldnotes-palette-fg);
  font-family: var(--fieldnotes-palette-font);
  padding: 16px;
}
.fieldnotes-dialog button, .fieldnotes-dialog input { font: inherit; }
.fieldnotes-dialog button:focus, .fieldnotes-dialog input:focus { background: var(--fieldnotes-palette-active); }
.fieldnotes-dialog kbd { border: 1px solid var(--fieldnotes-palette-border); border-radius: 3px; padding: 2px 5px; }
.fieldnotes-dialog mark { background: transparent; color: inherit; font-weight: 600; }
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
