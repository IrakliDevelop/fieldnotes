import { h, isRecord } from './shared';
import type { WidgetDef } from './shared';

interface CounterData {
  label: string;
  value: number;
}

const initialData = (): CounterData => ({ label: 'Counter', value: 0 });

function refresh(dom: HTMLElement, data: CounterData): void {
  const title = dom.querySelector('.pg-widget-title');
  const value = dom.querySelector('.pg-counter-value');
  if (title) title.textContent = data.label;
  if (value) value.textContent = String(data.value);
}

/** A labelled counter with − and + buttons. */
export const counter: WidgetDef<CounterData> = {
  htmlType: 'pg:counter',
  label: 'Counter',
  icon: 'counter',
  size: { w: 200, h: 120 },
  initialData,
  parse(data) {
    if (!isRecord(data)) return initialData();
    const { label, value } = data;
    if (typeof label !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) {
      return initialData();
    }
    return { label, value };
  },
  render(data, commit) {
    const step = (text: string, name: string, delta: number): HTMLButtonElement => {
      const button = h('button', 'pg-counter-step', text);
      button.type = 'button';
      button.setAttribute('aria-label', name);
      button.addEventListener('click', () =>
        commit((current) => ({ ...current, value: current.value + delta })),
      );
      return button;
    };
    const row = h('div', 'pg-counter-row');
    row.append(
      step('−', 'Decrease', -1),
      h('output', 'pg-counter-value'),
      step('+', 'Increase', 1),
    );
    const root = h('div', 'pg-widget pg-counter');
    root.append(h('div', 'pg-widget-title'), row);
    refresh(root, data);
    return root;
  },
  refresh,
};
