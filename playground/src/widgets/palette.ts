import { h, HEX_COLOR, isRecord, TOAST_EVENT } from './shared';
import type { WidgetDef } from './shared';

interface PaletteData {
  colors: string[];
}

const DEFAULT_COLOR = '#e4e4e7';

const initialData = (): PaletteData => ({
  colors: ['#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#e53935', '#8e24aa'],
});

const toast = (from: HTMLElement, message: string): void => {
  from.dispatchEvent(new CustomEvent(TOAST_EVENT, { bubbles: true, detail: message }));
};

function refresh(dom: HTMLElement, data: PaletteData): void {
  const grid = dom.querySelector('.pg-palette-grid');
  if (!grid) return;
  grid.replaceChildren(
    ...data.colors.map((value) => {
      const color = HEX_COLOR.test(value) ? value : DEFAULT_COLOR;
      const swatch = h('button', 'pg-palette-swatch');
      swatch.type = 'button';
      swatch.style.background = color;
      swatch.setAttribute('aria-label', `Copy ${color}`);
      swatch.title = color;
      swatch.dataset['color'] = color;
      return swatch;
    }),
  );
}

/** Colour swatches; clicking one copies its hex code. */
export const palette: WidgetDef<PaletteData> = {
  htmlType: 'pg:palette',
  label: 'Palette',
  icon: 'palette',
  size: { w: 240, h: 150 },
  initialData,
  parse(data) {
    if (!isRecord(data)) return initialData();
    const { colors } = data;
    if (!Array.isArray(colors) || !colors.every((c) => typeof c === 'string')) {
      return initialData();
    }
    return { colors };
  },
  render(data) {
    const grid = h('div', 'pg-palette-grid');
    grid.addEventListener('click', (event) => {
      const swatch = event.target instanceof Element ? event.target.closest('button') : null;
      const color = swatch?.dataset['color'];
      if (!color) return;
      // Promise.resolve().then also turns a missing navigator.clipboard into a rejection.
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(color))
        .then(
          () => toast(grid, `Copied ${color}`),
          () => toast(grid, 'Copy failed'),
        );
    });
    const root = h('div', 'pg-widget pg-palette');
    root.append(h('div', 'pg-widget-title', 'Palette'), grid);
    refresh(root, data);
    return root;
  },
  refresh,
};
