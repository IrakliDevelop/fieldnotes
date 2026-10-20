import type { Viewport } from '@fieldnotes/core';

export function mapLayers(viewport: Viewport): void {
  // #region create
  const { layerManager } = viewport;
  const mapId = layerManager.activeLayerId;
  layerManager.renameLayer(mapId, 'Map');
  const tokens = layerManager.createLayer('Tokens');

  layerManager.setActiveLayer(tokens.id);
  layerManager.setLayerLocked(mapId, true);
  // #endregion create

  // #region move
  const ids = viewport.getSelectedIds();
  viewport.transaction(() => {
    for (const id of ids) viewport.layerManager.moveElementToLayer(id, mapId);
  });
  // #endregion move
}

export function layerList(viewport: Viewport): void {
  // #region list
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const list = document.getElementById('layers')!;
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
  viewport.layerManager.on('change', render);
  // #endregion list
}
