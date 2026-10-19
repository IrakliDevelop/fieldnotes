import { h, isRecord } from './shared';
import type { WidgetDef } from './shared';

interface Bar {
  label: string;
  value: number;
}
interface ChartData {
  bars: Bar[];
}

const MAX_BARS = 12;

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

const initialData = (): ChartData => ({
  bars: [
    { label: 'Q1', value: 40 },
    { label: 'Q2', value: 65 },
    { label: 'Q3', value: 30 },
    { label: 'Q4', value: 80 },
  ],
});

function isBar(value: unknown): value is Bar {
  return (
    isRecord(value) &&
    typeof value['label'] === 'string' &&
    typeof value['value'] === 'number' &&
    Number.isFinite(value['value'])
  );
}

function column(index: number): HTMLElement {
  const col = h('div', 'pg-chart-column');
  const track = h('div', 'pg-chart-track');
  track.append(h('div', 'pg-chart-bar'));
  const input = h('input', 'pg-widget-input pg-chart-input');
  input.type = 'number';
  input.min = '0';
  input.max = '100';
  input.dataset['index'] = String(index);
  col.append(track, input, h('div', 'pg-chart-label'));
  return col;
}

function refresh(dom: HTMLElement, data: ChartData): void {
  const columns = dom.querySelector('.pg-chart-columns');
  if (!columns) return;
  while (columns.children.length > data.bars.length) columns.lastElementChild?.remove();
  while (columns.children.length < data.bars.length) {
    columns.append(column(columns.children.length));
  }
  data.bars.forEach((bar, index) => {
    const col = columns.children[index];
    if (!col) return;
    const fill = col.querySelector<HTMLElement>('.pg-chart-bar');
    const input = col.querySelector('input');
    const label = col.querySelector('.pg-chart-label');
    if (fill) fill.style.height = `${bar.value}%`;
    if (label) label.textContent = bar.label;
    if (!input) return;
    input.setAttribute('aria-label', `${bar.label} value`);
    if (input !== document.activeElement) input.value = String(bar.value);
  });
}

/** A bar chart whose values (0–100) are edited in place. */
export const chart: WidgetDef<ChartData> = {
  htmlType: 'pg:chart',
  label: 'Bar chart',
  icon: 'chart',
  size: { w: 280, h: 220 },
  initialData,
  parse(data) {
    if (!isRecord(data)) return initialData();
    const { bars } = data;
    if (!Array.isArray(bars) || !bars.every(isBar)) return initialData();
    // Cap remote or crafted payloads so they cannot build unbounded columns.
    return {
      bars: bars.slice(0, MAX_BARS).map((bar) => ({ label: bar.label, value: clamp(bar.value) })),
    };
  },
  render(data, commit) {
    const columns = h('div', 'pg-chart-columns');
    columns.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const index = Number(input.dataset['index']);
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      commit((current) => ({
        bars: current.bars.map((bar, i) => (i === index ? { ...bar, value: clamp(value) } : bar)),
      }));
    });
    const root = h('div', 'pg-widget pg-chart');
    root.append(columns);
    refresh(root, data);
    return root;
  },
  refresh,
};
