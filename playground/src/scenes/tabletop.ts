import { HandTool, LaserTool, PencilTool, PingTool, SelectTool, Viewport } from '@fieldnotes/core';
import type { CanvasElement } from '@fieldnotes/core';
import type { ClientSyncPlugin } from '@fieldnotes/sync';
import {
  createFogPlugin,
  FogTool,
  GridController,
  MeasureTool,
  registerVttElementTypes,
  TemplateTool,
} from '@fieldnotes/vtt';
import type { FogManager, TemplateShape } from '@fieldnotes/vtt';
import { createFogClientPlugin } from '@fieldnotes/vtt/sync';
import { buildTabletopSample } from '../samples/tabletop';
import type { FlyoutItem, Scene, StyleControl, ToolSpec } from '../scene';
import { registerWidgets } from '../widgets';
import { NAVIGATION_TOOLS, VIEWPORT_OPTIONS } from './whiteboard';

// registerVttElementTypes throws if the default registry already has the VTT types.
let registered = false;
let fog: FogManager | null = null;

/** The mounted Tabletop scene's fog manager, or null when it is not mounted. */
export function currentFog(): FogManager | null {
  return fog;
}

/** Sync plugins for a room on the mounted Tabletop scene; none when it is not mounted. */
export function fogClientPlugins(): ClientSyncPlugin[] {
  return fog ? [createFogClientPlugin({ manager: fog })] : [];
}

const SHAPES: readonly (readonly [TemplateShape, string, FlyoutItem['icon']])[] = [
  ['circle', 'Circle', 'circle'],
  ['cone', 'Cone', 'cone'],
  ['line', 'Line', 'line'],
  ['square', 'Square', 'square'],
];

const STYLE_CONTROLS: Readonly<Record<string, readonly StyleControl[]>> = {
  pencil: ['stroke-color', 'stroke-width'],
  template: ['fill-color'],
};

type Choice = readonly [text: string, label: string, isOn: () => boolean, run: () => void];

/** A labelled row of toggle buttons and a function that re-reads their pressed state. */
function choices(title: string, entries: readonly Choice[]): { el: HTMLElement; sync: () => void } {
  const el = document.createElement('div');
  el.className = 'style-control';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', title);
  const heading = document.createElement('span');
  heading.className = 'style-label';
  heading.textContent = title;
  el.append(heading);
  const buttons = entries.map(([text, label, isOn, run]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    // Keep focus on the canvas so shortcuts and undo keys still apply after a click.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      run();
      sync();
    });
    el.append(button);
    return [button, isOn] as const;
  });
  const sync = (): void => {
    for (const [button, isOn] of buttons) button.setAttribute('aria-pressed', String(isOn()));
  };
  sync();
  return { el, sync };
}

/** Hex map with tokens, fog of war, AoE templates and measuring. */
export const tabletop: Scene = {
  id: 'tabletop',
  label: 'Tabletop',
  mount({ stage, shell }) {
    if (!registered) {
      registerVttElementTypes();
      registered = true;
    }
    const fogPlugin = createFogPlugin({
      editorStyle: {
        kind: 'procedural',
        backdrop: 'rgba(30, 40, 60, 0.45)',
        tint: 'rgba(150, 170, 210, 0.8)',
        opacity: 0.45,
        scale: 256,
        seed: 42,
        detail: 2,
      },
      playerStyle: {
        kind: 'procedural',
        backdrop: '#0b1020',
        tint: '#596683',
        opacity: 0.55,
        scale: 256,
        seed: 42,
        detail: 2,
      },
    });
    const { manager } = fogPlugin;
    const templateTool = new TemplateTool();
    const fogTool = new FogTool(manager, { operation: 'reveal', radius: 40 });
    const viewport = new Viewport(stage, {
      ...VIEWPORT_OPTIONS,
      plugins: [fogPlugin],
      tools: [
        new SelectTool(),
        new HandTool(),
        new PencilTool(),
        new MeasureTool({ feetPerCell: 5 }),
        templateTool,
        fogTool,
        new PingTool(),
        new LaserTool(),
      ],
    });
    const gridController = new GridController({
      store: viewport.store,
      recorder: viewport.historyRecorder,
      requestRender: () => viewport.requestRender(),
      getActiveLayerId: () => viewport.layerManager.activeLayerId,
      toolContext: viewport.toolContext,
      defaultGridSize: 24,
      elementRegistry: viewport.elementRegistry,
      constraintService: viewport.constraintProxy,
    });
    const unregisterWidgets = registerWidgets(viewport, shell.toast);
    // Task 9 replaces this with a mode chosen by the room role.
    manager.setViewMode('editor');
    fog = manager;

    // Restores, undo and peers change the grid without going through the controller.
    const isGrid = (el: CanvasElement): boolean =>
      el.type === 'extension' && el.extensionType === 'vtt:grid';
    const syncGrid = (el: CanvasElement): void => {
      if (isGrid(el)) gridController.syncContext();
    };
    let syncGridSection: (() => void) | null = null;
    const unsubscribers = [
      viewport.store.on('add', syncGrid),
      viewport.store.on('update', ({ current }) => syncGrid(current)),
      viewport.store.on('remove', syncGrid),
      viewport.store.on('clear', () => gridController.syncContext()),
      gridController.onChange(() => syncGridSection?.()),
    ];

    const gridSection = (): HTMLElement => {
      const info = () => gridController.getInfo();
      const { el, sync } = choices('Grid', [
        [
          'Square',
          'Square grid',
          () => info()?.gridType === 'square',
          () => gridController.update({ gridType: 'square' }),
        ],
        [
          'Hex',
          'Hex grid',
          () => info()?.gridType === 'hex',
          () => gridController.update({ gridType: 'hex' }),
        ],
        ...[24, 32, 48].map((cellSize): Choice => [
          String(cellSize),
          `Cell size ${cellSize}`,
          () => info()?.cellSize === cellSize,
          () => gridController.update({ cellSize }),
        ]),
        [
          'Show',
          'Show grid',
          () => info() !== null,
          () => {
            if (!info())
              gridController.add({ gridType: 'hex', hexOrientation: 'pointy', cellSize: 48 });
          },
        ],
        ['Hide', 'Hide grid', () => info() === null, () => gridController.remove()],
      ]);
      syncGridSection = sync;
      return el;
    };

    const fogSection = (): HTMLElement => {
      const options = () => fogTool.getOptions();
      const { el } = choices('Fog', [
        [
          'Reveal',
          'Reveal fog',
          () => options().operation === 'reveal',
          () => fogTool.setOptions({ operation: 'reveal' }),
        ],
        [
          'Conceal',
          'Conceal fog',
          () => options().operation === 'conceal',
          () => fogTool.setOptions({ operation: 'conceal' }),
        ],
        ...[20, 40, 80].map((radius): Choice => [
          String(radius),
          `Brush ${radius}`,
          () => options().radius === radius,
          () => fogTool.setOptions({ radius }),
        ]),
      ]);
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', 'View as player');
      toggle.checked = manager.getViewMode() === 'player';
      toggle.addEventListener('change', () => {
        manager.setViewMode(toggle.checked ? 'player' : 'editor');
        viewport.requestRender();
      });
      const label = document.createElement('label');
      label.className = 'style-control style-switch';
      // Keep focus on the canvas so tool keys still work; Tab and Space still reach the switch.
      label.addEventListener('mousedown', (event) => event.preventDefault());
      label.append(toggle, 'View as player');
      el.append(label);
      return el;
    };

    const tools: readonly ToolSpec[] = [
      ...NAVIGATION_TOOLS,
      { name: 'pencil', label: 'Pencil', icon: 'pencil', key: '3' },
      { name: 'measure', label: 'Measure', icon: 'measure', key: '4' },
      {
        name: 'template',
        label: 'Template',
        icon: 'template',
        key: '5',
        flyout: SHAPES.map(([templateShape, label, icon]) => ({
          id: templateShape,
          label,
          icon,
          select: () => templateTool.setOptions({ templateShape }),
        })),
      },
      { name: 'fog', label: 'Fog', icon: 'fog', key: '6' },
      { name: 'ping', label: 'Ping', icon: 'ping', key: '7' },
      { name: 'laser', label: 'Laser', icon: 'laser', key: 'l' },
    ];

    return {
      viewport,
      tools,
      styles: {
        controlsFor: (toolName) => STYLE_CONTROLS[toolName] ?? [],
        extraSection: (toolName) => {
          if (toolName === 'fog') return fogSection();
          // Board setup, so it stays out of the way of the drawing tools' controls.
          return toolName === 'select' || toolName === 'hand' ? gridSection() : null;
        },
      },
      loadSample: () => buildTabletopSample(viewport, gridController, manager),
      dispose: () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        unregisterWidgets();
        fog = null;
        viewport.destroy();
      },
    };
  },
};
