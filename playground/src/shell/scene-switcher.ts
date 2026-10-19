import type { Scene, SceneId } from '../scene';
import { icon } from './icons';

// Phone widths leave the select about 68 px beside the zoom bar.
const SHORT_LABELS: Readonly<Record<SceneId, string>> = {
  whiteboard: 'Board',
  tabletop: 'Table',
  embeds: 'Embeds',
};

/** Renders the segmented scene control (a `<select>` at ≤ 600 px, via CSS) into `root`. */
export function renderSceneSwitcher(
  root: HTMLElement,
  scenes: readonly Scene[],
  current: SceneId,
  onSelect: (id: SceneId) => void,
): void {
  root.replaceChildren();
  const select = document.createElement('select');
  select.className = 'scene-select';
  select.setAttribute('aria-label', 'Scene');
  for (const scene of scenes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.textContent = scene.label;
    button.setAttribute('aria-pressed', String(scene.id === current));
    button.addEventListener('click', () => onSelect(scene.id));
    root.append(button);
    select.append(new Option(SHORT_LABELS[scene.id], scene.id, false, scene.id === current));
  }
  select.addEventListener('change', () => {
    const scene = scenes.find((s) => s.id === select.value);
    if (scene) onSelect(scene.id);
  });
  const wrap = document.createElement('span');
  wrap.className = 'scene-select-wrap';
  wrap.append(select, icon('chevron-down'));
  root.append(wrap);
}
