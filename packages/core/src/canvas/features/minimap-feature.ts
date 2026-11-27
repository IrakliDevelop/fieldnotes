import { Minimap } from '../minimap';
import { featureHostOf } from '../feature-host';
import type { ViewportPlugin } from '../viewport-plugin';

/** The bottom-right overview minimap with tap/drag-to-navigate. */
export function minimapFeature(): ViewportPlugin {
  return {
    name: 'fieldnotes:minimap',
    required: true,
    priority: -800,
    start: ({ viewport, addDisposer }) => {
      const host = featureHostOf(viewport);
      const minimap = new Minimap(host.wrapper, viewport, {
        minimapHooks: viewport.renderHooks.minimap,
        getExtraBounds: () => host.getExtraBounds(),
      });
      host.setMinimap(minimap);
      const unsubTheme = viewport.onThemeChange((theme) => minimap.setTheme(theme));
      addDisposer(() => {
        unsubTheme();
        host.setMinimap(null);
        minimap.destroy();
      });
      return undefined;
    },
  };
}
