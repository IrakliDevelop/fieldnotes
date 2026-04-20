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
