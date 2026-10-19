import { h, isRecord } from './index';
import type { WidgetDef } from './index';

interface Item {
  id: string;
  text: string;
  done: boolean;
}
interface ChecklistData {
  title: string;
  items: Item[];
}

const initialData = (): ChecklistData => ({
  title: 'Checklist',
  items: [
    { id: crypto.randomUUID(), text: 'Double-click to use me', done: false },
    { id: crypto.randomUUID(), text: 'Tick an item', done: false },
  ],
});

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['text'] === 'string' &&
    typeof value['done'] === 'boolean'
  );
}

function row(id: string): HTMLLIElement {
  const li = h('li', 'pg-checklist-item');
  li.dataset['itemId'] = id;
  const box = h('input', 'pg-checklist-box');
  box.type = 'checkbox';
  box.setAttribute('aria-label', 'Done');
  const remove = h('button', 'pg-widget-icon-button', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove item');
  li.append(box, h('span', 'pg-checklist-text'), remove);
  return li;
}

// Rows are keyed by item id and patched in place so a focused checkbox keeps its focus.
function refresh(dom: HTMLElement, data: ChecklistData): void {
  const title = dom.querySelector('.pg-widget-title');
  const list = dom.querySelector('.pg-checklist-list');
  if (title) title.textContent = data.title;
  if (!list) return;
  const rows = new Map<string, Element>();
  for (const li of list.children) {
    if (li instanceof HTMLElement && li.dataset['itemId']) rows.set(li.dataset['itemId'], li);
  }
  data.items.forEach((item, index) => {
    const li = rows.get(item.id) ?? row(item.id);
    rows.delete(item.id);
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
    const box = li.querySelector('input');
    const text = li.querySelector('.pg-checklist-text');
    if (box) box.checked = item.done;
    if (text) text.textContent = item.text;
  });
  for (const stale of rows.values()) stale.remove();
}

const itemIdOf = (target: EventTarget | null): string | undefined =>
  target instanceof Element
    ? target.closest<HTMLElement>('[data-item-id]')?.dataset['itemId']
    : undefined;

/** A titled checklist: add, tick and remove items. */
export const checklist: WidgetDef<ChecklistData> = {
  htmlType: 'pg:checklist',
  label: 'Checklist',
  icon: 'checklist',
  size: { w: 260, h: 260 },
  initialData,
  parse(data) {
    if (!isRecord(data)) return initialData();
    const { title, items } = data;
    if (typeof title !== 'string' || !Array.isArray(items) || !items.every(isItem)) {
      return initialData();
    }
    return { title, items };
  },
  render(data, commit) {
    const list = h('ul', 'pg-checklist-list');
    list.addEventListener('change', (event) => {
      const id = itemIdOf(event.target);
      if (!id || !(event.target instanceof HTMLInputElement)) return;
      const done = event.target.checked;
      commit((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, done } : item)),
      }));
    });
    list.addEventListener('click', (event) => {
      const id = itemIdOf(event.target);
      if (!id || !(event.target instanceof Element) || !event.target.closest('button')) return;
      commit((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    });

    const form = h('form', 'pg-checklist-add');
    const input = h('input', 'pg-widget-input');
    input.placeholder = 'Add an item';
    input.setAttribute('aria-label', 'New item');
    const add = h('button', 'pg-widget-icon-button', '+');
    add.type = 'submit';
    add.setAttribute('aria-label', 'Add item');
    form.append(input, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const item = { id: crypto.randomUUID(), text, done: false };
      commit((current) => ({ ...current, items: [...current.items, item] }));
    });

    const root = h('div', 'pg-widget pg-checklist');
    root.append(h('div', 'pg-widget-title'), list, form);
    refresh(root, data);
    return root;
  },
  refresh,
};
