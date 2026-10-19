import { h, HEX_COLOR, isRecord } from './shared';
import type { WidgetDef } from './shared';

interface TokenData {
  name: string;
  initials: string;
  color: string;
  hp: number;
  maxHp: number;
}

const DEFAULT_COLOR = '#1971c2';

const initialData = (): TokenData => ({
  name: 'Token',
  initials: 'T',
  color: DEFAULT_COLOR,
  hp: 10,
  maxHp: 10,
});

function refresh(dom: HTMLElement, data: TokenData): void {
  const avatar = dom.querySelector<HTMLElement>('.pg-token-avatar');
  const name = dom.querySelector('.pg-widget-title');
  const fill = dom.querySelector<HTMLElement>('.pg-token-fill');
  const hp = dom.querySelector('.pg-token-hp');
  if (avatar) {
    avatar.textContent = data.initials;
    avatar.style.background = HEX_COLOR.test(data.color) ? data.color : DEFAULT_COLOR;
  }
  if (name) name.textContent = data.name;
  if (fill) fill.style.width = `${(100 * data.hp) / data.maxHp}%`;
  if (hp) hp.textContent = `${data.hp} / ${data.maxHp}`;
}

/** A tabletop token: initials in a coloured circle, a name and an HP bar with − and +. */
export const token: WidgetDef<TokenData> = {
  htmlType: 'pg:token',
  label: 'Token',
  icon: 'token',
  size: { w: 160, h: 180 },
  initialData,
  parse(data) {
    if (!isRecord(data)) return initialData();
    const { name, initials, color, hp, maxHp } = data;
    if (
      typeof name !== 'string' ||
      typeof initials !== 'string' ||
      typeof color !== 'string' ||
      typeof hp !== 'number' ||
      typeof maxHp !== 'number' ||
      !Number.isFinite(hp) ||
      !Number.isFinite(maxHp)
    ) {
      return initialData();
    }
    // Imported or peer data may break the 0..maxHp invariant the bar and buttons rely on.
    const max = Math.max(1, maxHp);
    return { name, initials, color, hp: Math.min(max, Math.max(0, hp)), maxHp: max };
  },
  render(data, commit) {
    const step = (text: string, label: string, delta: number): HTMLButtonElement => {
      const button = h('button', 'pg-counter-step', text);
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () =>
        commit((current) => ({
          ...current,
          hp: Math.min(current.maxHp, Math.max(0, current.hp + delta)),
        })),
      );
      return button;
    };
    const bar = h('div', 'pg-token-bar');
    bar.append(h('div', 'pg-token-fill'));
    const row = h('div', 'pg-counter-row');
    row.append(
      step('−', 'Decrease HP', -1),
      h('output', 'pg-token-hp'),
      step('+', 'Increase HP', 1),
    );
    const root = h('div', 'pg-widget pg-token');
    root.append(h('div', 'pg-token-avatar'), h('div', 'pg-widget-title'), bar, row);
    refresh(root, data);
    return root;
  },
  refresh,
};
