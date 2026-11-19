import { DEFAULT_NOTE_FONT_SIZE } from './element-factory';
import { setFontSize, getActiveFormats } from './note-formatting';
import { DEFAULT_THEME, LIGHT_THEME_TOKENS } from '../canvas/theme';
import type { ResolvedTheme } from '../canvas/theme';

const TOOLBAR_HEIGHT = 52;
const TOOLBAR_GAP = 4;

interface FormatButton {
  label: string;
  format: string;
  command: string;
}

const FORMAT_BUTTONS: FormatButton[] = [
  { label: 'B', format: 'bold', command: 'bold' },
  { label: 'I', format: 'italic', command: 'italic' },
  { label: 'U', format: 'underline', command: 'underline' },
  { label: 'S', format: 'strikethrough', command: 'strikeThrough' },
];

export interface FontSizePreset {
  label: string;
  size: number;
}

export const DEFAULT_FONT_SIZE_PRESETS: FontSizePreset[] = [
  { label: 'Small', size: 14 },
  { label: 'Normal', size: 18 },
  { label: 'Large', size: 24 },
  { label: 'Heading', size: 32 },
];

export class NoteToolbar {
  private el: HTMLDivElement | null = null;
  private anchor: HTMLElement | null = null;
  private positionProvider: (() => DOMRect | null) | null = null;
  private selectionListener: (() => void) | null = null;
  private readonly fontSizePresets: FontSizePreset[];
  private theme: ResolvedTheme = DEFAULT_THEME;

  constructor(fontSizePresets?: FontSizePreset[]) {
    this.fontSizePresets = fontSizePresets ?? DEFAULT_FONT_SIZE_PRESETS;
  }

  setTheme(theme: ResolvedTheme): void {
    this.theme = theme;
    if (this.el) this.applyTheme(this.el);
  }

  show(anchor: HTMLElement, positionProvider?: () => DOMRect | null): void {
    this.hide();
    this.anchor = anchor;
    this.positionProvider = positionProvider ?? null;
    this.el = this.createToolbarElement();
    document.body.appendChild(this.el);
    this.positionToolbar();
    this.selectionListener = () => this.updateActiveStates();
    document.addEventListener('selectionchange', this.selectionListener);
  }

  hide(): void {
    if (this.selectionListener) {
      document.removeEventListener('selectionchange', this.selectionListener);
      this.selectionListener = null;
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.anchor = null;
    this.positionProvider = null;
  }

  getElement(): HTMLDivElement | null {
    return this.el;
  }

  updatePosition(): void {
    if (this.el) {
      this.positionToolbar();
    }
  }

  private createToolbarElement(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.dataset['noteToolbar'] = '';
    Object.assign(toolbar.style, {
      position: 'fixed',
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '2px 4px',
      background: this.theme.tokens.toolbarBackground,
      border: `1px solid ${this.theme.tokens.toolbarBorder}`,
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: '10000',
      height: `${TOOLBAR_HEIGHT}px`,
      userSelect: 'none',
    });

    for (const btn of FORMAT_BUTTONS) {
      toolbar.appendChild(this.createFormatButton(btn));
    }

    toolbar.appendChild(this.createFontSizeSelect());
    this.applyTheme(toolbar);

    return toolbar;
  }

  private createFormatButton(config: FormatButton): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.dataset['format'] = config.format;
    btn.textContent = config.label;
    Object.assign(btn.style, {
      border: '1px solid transparent',
      borderRadius: '3px',
      background: 'none',
      cursor: 'pointer',
      padding: '2px 6px',
      fontSize: '13px',
      fontWeight: config.format === 'bold' ? 'bold' : 'normal',
      fontStyle: config.format === 'italic' ? 'italic' : 'normal',
      textDecoration:
        config.format === 'underline'
          ? 'underline'
          : config.format === 'strikethrough'
            ? 'line-through'
            : 'none',
      minWidth: '44px',
      height: '44px',
      lineHeight: '44px',
    });
    if (this.theme.tokens.chromeText) btn.style.color = this.theme.tokens.chromeText;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      document.execCommand(config.command);
      this.updateActiveStates();
    });

    return btn;
  }

  private createFontSizeSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    Object.assign(select.style, {
      border: `1px solid ${this.theme.tokens.toolbarBorder}`,
      borderRadius: '3px',
      background: this.theme.tokens.toolbarBackground,
      cursor: 'pointer',
      padding: '2px',
      fontSize: '12px',
      height: '44px',
      marginLeft: '4px',
    });
    if (this.theme.tokens.chromeText) select.style.color = this.theme.tokens.chromeText;

    for (const preset of this.fontSizePresets) {
      const option = document.createElement('option');
      option.value = String(preset.size);
      option.textContent = preset.label;
      select.appendChild(option);
    }

    select.value = String(DEFAULT_NOTE_FONT_SIZE);

    select.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    select.addEventListener('change', () => {
      this.applyFontSize(Number(select.value));
      this.updateActiveStates();
      this.anchor?.focus();
    });

    return select;
  }

  private applyFontSize(size: number): void {
    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed;
    if (collapsed && this.anchor) {
      const range = document.createRange();
      range.selectNodeContents(this.anchor);
      sel?.removeAllRanges();
      sel?.addRange(range);
      setFontSize(size);
      const after = window.getSelection();
      if (after) {
        const caret = document.createRange();
        caret.selectNodeContents(this.anchor);
        caret.collapse(false);
        after.removeAllRanges();
        after.addRange(caret);
      }
      return;
    }
    setFontSize(size);
  }

  private positionToolbar(): void {
    if (!this.el) return;

    const rect = this.positionProvider?.() ?? this.anchor?.getBoundingClientRect();
    if (!rect) return;
    const toolbarWidth = this.el.offsetWidth || 200;

    let top = rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP;
    if (top < 0) {
      top = rect.bottom + TOOLBAR_GAP;
    }

    let left = rect.left + (rect.width - toolbarWidth) / 2;
    left = Math.max(4, left);

    Object.assign(this.el.style, {
      top: `${top}px`,
      left: `${left}px`,
    });
  }

  private updateActiveStates(): void {
    if (!this.el) return;

    const active = getActiveFormats();
    for (const config of FORMAT_BUTTONS) {
      const btn = this.el.querySelector(`[data-format="${config.format}"]`) as HTMLElement | null;
      if (!btn) continue;

      const isActive = active[config.format as keyof typeof active] ?? false;
      btn.style.background = isActive ? this.theme.tokens.toolbarActive : 'none';
      btn.style.borderColor = isActive
        ? this.theme.tokens.toolbarBorder === LIGHT_THEME_TOKENS.toolbarBorder
          ? '#bbb'
          : this.theme.tokens.toolbarBorder
        : 'transparent';
    }
  }

  private applyTheme(toolbar: HTMLDivElement): void {
    toolbar.style.background = this.theme.tokens.toolbarBackground;
    toolbar.style.border = `1px solid ${this.theme.tokens.toolbarBorder}`;
    if (this.theme.tokens.chromeText) toolbar.style.color = this.theme.tokens.chromeText;
    else toolbar.style.removeProperty('color');
    const select = toolbar.querySelector<HTMLSelectElement>('select');
    if (select) {
      select.style.border = `1px solid ${this.theme.tokens.toolbarBorder}`;
      select.style.background = this.theme.tokens.toolbarBackground;
      if (this.theme.tokens.chromeText) select.style.color = this.theme.tokens.chromeText;
      else select.style.removeProperty('color');
    }
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('button')) {
      if (this.theme.tokens.chromeText) button.style.color = this.theme.tokens.chromeText;
      else button.style.removeProperty('color');
    }
    this.updateActiveStates();
  }
}
