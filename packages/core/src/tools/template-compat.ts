import type { ElementRegistry } from '../elements/element-registry';
import type { CanvasElement, TemplateElement } from '../elements/types';

/** v3 compatibility bridge: lets legacy template controls operate on registered envelopes. */
export function resolveTemplateElement(
  element: CanvasElement,
  registry: ElementRegistry | undefined,
): TemplateElement | null {
  if (element.type === 'template') return element;
  if (element.type !== 'extension' || !registry) return null;
  const adapter = registry.getAdapter(element.extensionType);
  if (!adapter?.legacyTypes.includes('template')) return null;
  const unwrapped = adapter.unwrap(element);
  return unwrapped.type === 'template' ? (unwrapped as TemplateElement) : null;
}

export function updateTemplateElement(
  element: CanvasElement,
  template: TemplateElement,
  registry: ElementRegistry | undefined,
): Partial<CanvasElement> {
  if (element.type === 'template') return template;
  if (element.type !== 'extension' || !registry) return {};
  const adapter = registry.getAdapter(element.extensionType);
  if (!adapter?.legacyTypes.includes('template')) return {};
  const wrapped = adapter.wrap(template);
  return { ...wrapped, data: { ...element.data, ...wrapped.data } };
}
