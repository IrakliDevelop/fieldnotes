interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontSize: number;
}

export interface StyledRun extends RunStyle {
  text: string;
}

const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_TAGS = new Set(['i', 'em']);
const UNDERLINE_TAGS = new Set(['u']);
const STRIKE_TAGS = new Set(['s', 'strike', 'del']);
const BLOCK_TAGS = new Set(['div']);

export function parseStyledRuns(html: string, baseFontSize: number): StyledRun[] {
  if (!html) return [];

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const runs: StyledRun[] = [];
  const baseStyle: RunStyle = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    fontSize: baseFontSize,
  };

  walkNodes(doc.body, baseStyle, runs);
  return runs;
}

function walkNodes(node: Node, style: RunStyle, runs: StyledRun[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) {
        runs.push({ text, ...style });
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      runs.push({ text: '\n', ...style });
      continue;
    }

    if (BLOCK_TAGS.has(tag) && runs.length > 0) {
      const lastRun = runs[runs.length - 1];
      if (lastRun && !lastRun.text.endsWith('\n')) {
        runs.push({ text: '\n', ...style });
      }
    }

    const childStyle = { ...style };
    if (BOLD_TAGS.has(tag)) childStyle.bold = true;
    if (ITALIC_TAGS.has(tag)) childStyle.italic = true;
    if (UNDERLINE_TAGS.has(tag)) childStyle.underline = true;
    if (STRIKE_TAGS.has(tag)) childStyle.strikethrough = true;

    if (tag === 'span') {
      const fontSize = (el as HTMLElement).style.fontSize;
      if (fontSize) {
        childStyle.fontSize = parseInt(fontSize, 10) || style.fontSize;
      }
    }

    walkNodes(el, childStyle, runs);
  }
}

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'span',
  'br',
  'div',
]);

export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      while (el.firstChild) {
        fragment.appendChild(el.firstChild);
      }
      node.replaceChild(fragment, el);
      sanitizeNode(node);
      return;
    }

    sanitizeAttributes(el, tag);
    sanitizeNode(el);
  }
}

function sanitizeAttributes(el: Element, tag: string): void {
  const attrs = Array.from(el.attributes);
  for (const attr of attrs) {
    if (tag === 'span' && attr.name === 'style') {
      const fontSize = (el as HTMLElement).style.fontSize;
      if (fontSize) {
        el.setAttribute('style', `font-size: ${fontSize};`);
      } else {
        el.removeAttribute('style');
      }
      continue;
    }
    el.removeAttribute(attr.name);
  }
}
