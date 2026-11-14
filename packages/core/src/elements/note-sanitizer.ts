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
const PLAIN_TEXT_BLOCK_TAGS = new Set(['div', 'p', 'li']);

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

// Recent outputs; sanitizing is idempotent, so an output passes through unparsed.
const SANITIZED_MEMO_SIZE = 256;
const sanitizedMemo = new Set<string>();
const ESCAPED_PLAIN_TEXT_ENTITIES = /&(amp|lt|gt|quot|#39);/g;
const RAW_HTML_SPECIAL_CHARACTER = /[&<>"']/;

export function escapePlainTextHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';
  if (isEscapedPlainText(html)) return html;
  if (sanitizedMemo.has(html)) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  const sanitized = doc.body.innerHTML;
  rememberSanitized(sanitized);
  return sanitized;
}

function isEscapedPlainText(html: string): boolean {
  return !RAW_HTML_SPECIAL_CHARACTER.test(html.replace(ESCAPED_PLAIN_TEXT_ENTITIES, ''));
}

function rememberSanitized(html: string): void {
  sanitizedMemo.add(html);
  if (sanitizedMemo.size > SANITIZED_MEMO_SIZE) {
    const oldest = sanitizedMemo.values().next().value;
    if (oldest !== undefined) sanitizedMemo.delete(oldest);
  }
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

/** Reads sanitized note html as plain text: `<br>` and block boundaries become newlines. */
export function plainTextOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let text = '';
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        text += '\n';
        continue;
      }
      walk(child);
      if (PLAIN_TEXT_BLOCK_TAGS.has(tag) && child.nextSibling) text += '\n';
    }
  };
  walk(doc.body);
  return text;
}

export function isNoteContentEmpty(html: string): boolean {
  if (!html) return true;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = doc.body.textContent ?? '';
  return text.replace(/\u00a0/g, ' ').trim().length === 0;
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
