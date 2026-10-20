import type { Viewport } from '@fieldnotes/core';

// #region create
export function setUpMapLayers(viewport: Viewport): string {
  const { layerManager } = viewport;
  const mapId = layerManager.activeLayerId;
  layerManager.renameLayer(mapId, 'Map');
  const tokens = layerManager.createLayer('Tokens');

  layerManager.setActiveLayer(tokens.id);
  layerManager.setLayerLocked(mapId, true);
  return mapId;
}
// #endregion create

// #region move
export function sendToMap(viewport: Viewport, ids: string[], mapId: string): void {
  viewport.transaction(() => {
    for (const id of ids) viewport.layerManager.moveElementToLayer(id, mapId);
  });
}
// #endregion move

// #region list
export function renderLayerList(viewport: Viewport, list: HTMLElement): () => void {
  const render = (): void => {
    const { layerManager } = viewport;
    list.replaceChildren(
      ...layerManager
        .getLayers()
        .reverse()
        .map((layer) => {
          const item = document.createElement('li');
          item.textContent = `${layer.name}${layer.visible ? '' : ' (hidden)'}`;
          if (layer.id === layerManager.activeLayerId) item.setAttribute('aria-current', 'true');
          return item;
        }),
    );
  };
  render();
  return viewport.layerManager.on('change', render);
}
// #endregion list
