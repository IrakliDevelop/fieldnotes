import type { Layer, Viewport } from '@fieldnotes/core';
import { icon } from './icons';
import type { IconName } from './icons';

function button(label: string, name: IconName, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'icon-button';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.append(icon(name));
  el.addEventListener('click', run);
  return el;
}

/** Renders the layer list for `viewport` into `root`; returns a cleanup. */
export function renderLayersPanel(root: HTMLElement, viewport: Viewport): () => void {
  const { layerManager } = viewport;

  const editName = (label: HTMLElement, layer: Layer): void => {
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.setAttribute('aria-label', 'Layer name');
    input.value = layer.name;
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name && name !== layer.name) layerManager.renameLayer(layer.id, name);
      else render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      // Keep core's window shortcuts (deselect) from also handling the key.
      event.stopPropagation();
      finish(event.key === 'Enter');
    });
    input.addEventListener('blur', () => finish(true));
    label.replaceWith(input);
    input.focus();
    input.select();
  };

  const row = (layer: Layer, index: number, layers: readonly Layer[]): HTMLElement => {
    const { id, name } = layer;
    const el = document.createElement('li');
    el.className = 'layer-row';
    el.setAttribute('aria-current', String(id === layerManager.activeLayerId));
    const label = document.createElement('span');
    label.className = 'layer-name';
    label.textContent = name;
    // Activating re-renders the list, so a dblclick listener on the old label would never fire.
    el.addEventListener('click', (event) => {
      if (event.target === label && event.detail === 2) {
        editName(label, layer);
        return;
      }
      if (event.target instanceof Element && event.target.closest('button, input')) return;
      if (id !== layerManager.activeLayerId) layerManager.setActiveLayer(id);
    });

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '100';
    opacity.value = String(Math.round(layer.opacity * 100));
    opacity.setAttribute('aria-label', `${name} opacity`);
    opacity.addEventListener('change', () =>
      layerManager.setLayerOpacity(id, Number(opacity.value) / 100),
    );

    // Swapping orders with a neighbour is two updates; keep it one undo step.
    const swapWith = (other: Layer | undefined): void => {
      if (!other) return;
      viewport.transaction(() => {
        layerManager.reorderLayer(id, other.order);
        layerManager.reorderLayer(other.id, layer.order);
      });
    };
    const up = button(`Move ${name} up`, 'chevron-up', () => swapWith(layers[index - 1]));
    up.disabled = index === 0;
    const down = button(`Move ${name} down`, 'chevron-down', () => swapWith(layers[index + 1]));
    down.disabled = index === layers.length - 1;
    const remove = button(`Delete ${name}`, 'trash', () => viewport.removeLayer(id));
    remove.disabled = layers.length === 1;

    el.append(
      label,
      button(
        layer.visible ? `Hide ${name}` : `Show ${name}`,
        layer.visible ? 'eye' : 'eye-off',
        () => layerManager.setLayerVisible(id, !layer.visible),
      ),
      button(
        layer.locked ? `Unlock ${name}` : `Lock ${name}`,
        layer.locked ? 'lock' : 'unlock',
        () => layerManager.setLayerLocked(id, !layer.locked),
      ),
      opacity,
      up,
      down,
      remove,
    );
    return el;
  };

  const render = (): void => {
    const layers = layerManager.getLayers().reverse();
    const header = document.createElement('div');
    header.className = 'layers-header';
    const title = document.createElement('span');
    title.textContent = 'Layers';
    const add = button('Add layer', 'plus', () => {
      const layer = layerManager.createLayer(`Layer ${layers.length + 1}`);
      layerManager.setActiveLayer(layer.id);
    });
    header.append(title, add);
    const list = document.createElement('ul');
    list.className = 'layers-list';
    list.append(...layers.map((layer, index) => row(layer, index, layers)));
    root.replaceChildren(header, list);
  };

  render();
  return layerManager.on('change', render);
}
