/** Marks the DOM node of an html element whose `interactive` flag is set. */
export const LIVE_NODE_ATTR = 'data-fn-live';

const CONTROL_SELECTOR =
  'a[href], button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe, [data-fn-control]';

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
  'hidden',
]);

/** True when `target` is inside a control of a live element node; the nearest `data-fn-drag` wins. */
export function isLiveControlTarget(target: EventTarget | null, boundary: Element): boolean {
  let decision: 'control' | 'drag' | undefined;
  for (
    let node = target instanceof Element ? target : null;
    node && node !== boundary;
    node = node.parentElement
  ) {
    if (!decision) {
      if (node.hasAttribute('data-fn-drag')) decision = 'drag';
      else if (node.matches(CONTROL_SELECTOR)) decision = 'control';
    }
    if (node.hasAttribute('data-element-id')) {
      return decision === 'control' && node.hasAttribute(LIVE_NODE_ATTR);
    }
  }
  return false;
}

/** True when `target` takes typed text: a textarea, a text-like input, or editable content. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  // jsdom lacks isContentEditable, so match the attribute.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
