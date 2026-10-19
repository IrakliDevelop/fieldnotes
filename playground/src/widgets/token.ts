import { h, isRecord } from './shared';
import type { WidgetDef } from './shared';

interface TokenData {
  name: string;
  initials: string;
  color: string;
  hp: number;
  maxHp: number;
}

const HEX = /^#[0-9a-f]{3,8}$/i;
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
    avatar.style.background = HEX.test(data.color) ? data.color : DEFAULT_COLOR;
  }
  if (name) name.textContent = data.name;
  if (fill) fill.style.width = `${data.maxHp > 0 ? (100 * data.hp) / data.maxHp : 0}%`;
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
    return { name, initials, color, hp, maxHp };
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
    // widget.css has no token rules, so the circle and bar are styled inline.
    const avatar = h('div', 'pg-token-avatar');
    Object.assign(avatar.style, {
      alignSelf: 'center',
      display: 'grid',
      placeItems: 'center',
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      color: '#ffffff',
      fontWeight: '700',
      fontSize: '20px',
    });
    const bar = h('div', 'pg-token-bar');
    Object.assign(bar.style, { height: '6px', borderRadius: '3px', background: '#e9ecef' });
    const fill = h('div', 'pg-token-fill');
    Object.assign(fill.style, { height: '100%', borderRadius: '3px', background: '#2f9e44' });
    bar.append(fill);
    const name = h('div', 'pg-widget-title');
    name.style.textAlign = 'center';
    const row = h('div', 'pg-counter-row');
    row.append(
      step('−', 'Decrease HP', -1),
      h('output', 'pg-token-hp'),
      step('+', 'Increase HP', 1),
    );
    const root = h('div', 'pg-widget pg-token');
    root.append(avatar, name, bar, row);
    refresh(root, data);
    return root;
  },
  refresh,
};
