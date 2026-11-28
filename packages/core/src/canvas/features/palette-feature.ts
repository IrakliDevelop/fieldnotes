import { CommandPalette, createPaletteActions } from '../command-palette';
import type { PaletteApi } from '../command-palette';
import { featureHostOf } from '../feature-host';
import { resolvePaletteStrings } from '../palette-model';
import type { PaletteOptions } from '../palette-model';
import { ShortcutsHelp } from '../shortcuts-help';
import type { ShortcutsHelpApi } from '../shortcuts-help';
import type { ViewportPlugin } from '../viewport-plugin';

interface Slot {
  palette: PaletteApi | null;
  help: ShortcutsHelpApi | null;
}

/** Command palette and shortcuts help with their `palette.*` actions. */
export function paletteFeature(options?: PaletteOptions): ViewportPlugin {
  // One viewport's configure and start run in the same constructor, so start claims the latest slot.
  let latest: Slot = { palette: null, help: null };
  return {
    name: 'fieldnotes:palette',
    required: true,
    priority: -900,
    configure: (context) => {
      const slot: Slot = { palette: null, help: null };
      latest = slot;
      // Actions register in configure, before the dialogs exist in start.
      const palette: PaletteApi = {
        open: () => slot.palette?.open(),
        close: () => slot.palette?.close(),
        isOpen: () => slot.palette?.isOpen() ?? false,
      };
      const help: ShortcutsHelpApi = {
        open: () => slot.help?.open(),
        close: () => slot.help?.close(),
        isOpen: () => slot.help?.isOpen() ?? false,
      };
      for (const action of createPaletteActions(palette, help)) context.registerAction(action);
    },
    start: ({ viewport, addDisposer }) => {
      const slot = latest;
      const host = featureHostOf(viewport);
      const strings = resolvePaletteStrings(options?.strings);
      const getTheme = () => viewport.getTheme();
      const help = new ShortcutsHelp({
        container: host.container,
        wrapper: host.wrapper,
        actions: host.actions,
        getActionContext: () => host.getActionContext(),
        getBindings: () => host.getBindings(),
        matchShortcut: (event) => host.matchShortcut(event),
        isMac: () => host.isMac(),
        strings,
        getTheme,
        closeOthers: () => {
          host.closeContextMenu();
          slot.palette?.close();
        },
      });
      const created = new CommandPalette({
        container: host.container,
        wrapper: host.wrapper,
        actions: host.actions,
        getActionContext: () => host.getActionContext(),
        getBindings: () => host.getBindings(),
        store: viewport.store,
        registry: viewport.elementRegistry,
        isLayerVisible: (id) => viewport.layerManager.isLayerVisible(id),
        camera: viewport.camera,
        getCanvasSize: () => viewport.getCanvasSize(),
        overlayHost: viewport,
        stopCameraMotion: () => host.stopCameraMotion(),
        closeContextMenu: () => host.closeContextMenu(),
        help,
        matchShortcut: (event) => host.matchShortcut(event),
        selectionColor: () => host.selectionColor(),
        isMac: () => host.isMac(),
        strings,
        getTheme,
      });
      slot.palette = created;
      slot.help = help;
      host.setPalette(created, help);
      const untrack = host.trackOverlay(() => created.isOpen() || help.isOpen());
      addDisposer(() => {
        untrack();
        host.setPalette(null, null);
        help.destroy();
        created.destroy();
        slot.palette = null;
        slot.help = null;
      });
      return undefined;
    },
  };
}
