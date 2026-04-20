export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

export function toggleBold(): void {
  document.execCommand('bold');
}

export function toggleItalic(): void {
  document.execCommand('italic');
}

export function toggleUnderline(): void {
  document.execCommand('underline');
}

export function toggleStrikethrough(): void {
  document.execCommand('strikeThrough');
}

export function setFontSize(size: number): void {
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
}

export function getActiveFormats(): ActiveFormats {
  const query = (cmd: string): boolean => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  return {
    bold: query('bold'),
    italic: query('italic'),
    underline: query('underline'),
    strikethrough: query('strikeThrough'),
  };
}
