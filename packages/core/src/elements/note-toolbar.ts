import { DEFAULT_NOTE_FONT_SIZE } from './element-factory';

const TOOLBAR_HEIGHT = 32;
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

const FONT_SIZE_PRESETS = [
  { label: 'Small', value: '12' },
  { label: 'Normal', value: '14' },
  { label: 'Large', value: '18' },
  { label: 'Heading', value: '24' },
];

export class NoteToolbar {
  private el: HTMLDivElement | null = null;
  private selectionListener: (() => void) | null = null;

  show(anchor: HTMLElement): void {
    this.hide();
    this.el = this.createToolbarElement();
    document.body.appendChild(this.el);
    this.positionToolbar(anchor);
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
  }

  getElement(): HTMLDivElement | null {
    return this.el;
  }

  updatePosition(anchor: HTMLElement): void {
    if (this.el) {
      this.positionToolbar(anchor);
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
      background: '#fff',
      border: '1px solid #ccc',
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
      minWidth: '24px',
      height: '24px',
      lineHeight: '24px',
    });

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
      border: '1px solid #ccc',
      borderRadius: '3px',
      background: '#fff',
      cursor: 'pointer',
      padding: '2px',
      fontSize: '12px',
      height: '24px',
      marginLeft: '4px',
    });

    for (const preset of FONT_SIZE_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.value;
      option.textContent = preset.label;
      select.appendChild(option);
    }

    select.value = String(DEFAULT_NOTE_FONT_SIZE);

    select.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    select.addEventListener('change', () => {
      const size = select.value;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      if (range.collapsed) return;

      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      try {
        range.surroundContents(span);
      } catch {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      }

      this.updateActiveStates();
    });

    return select;
  }

  private positionToolbar(anchor: HTMLElement): void {
    if (!this.el) return;

    const rect = anchor.getBoundingClientRect();
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

    for (const config of FORMAT_BUTTONS) {
      const btn = this.el.querySelector(`[data-format="${config.format}"]`) as HTMLElement | null;
      if (!btn) continue;

      let active = false;
      try {
        active = document.queryCommandState(config.command);
      } catch {
        // queryCommandState can throw for unsupported commands
      }
      btn.style.background = active ? '#e0e0e0' : 'none';
      btn.style.borderColor = active ? '#bbb' : 'transparent';
    }
  }
}
