import {
  ArrowTool,
  EraserTool,
  HandTool,
  ImageTool,
  LaserTool,
  NoteTool,
  PencilTool,
  SelectTool,
  ShapeTool,
  TextTool,
  Viewport,
} from '@fieldnotes/core';
import type { ViewportOptions } from '@fieldnotes/core';
import type { Scene, StyleControl, ToolSpec } from '../scene';

/** Viewport options every playground scene shares. */
export const VIEWPORT_OPTIONS = {
  background: { pattern: 'dots', spacing: 24, color: '#d4d4d8' },
  minimap: true,
  panInertia: true,
} satisfies ViewportOptions;

/** Select and Hand, the tools every scene starts with. */
export const NAVIGATION_TOOLS: readonly ToolSpec[] = [
  { name: 'select', label: 'Select', icon: 'select', key: '1' },
  { name: 'hand', label: 'Hand', icon: 'hand', key: '2' },
];

const CONTROLS: Readonly<Record<string, readonly StyleControl[]>> = {
  pencil: ['stroke-color', 'stroke-width', 'opacity'],
  highlighter: ['stroke-color', 'opacity'],
  arrow: ['stroke-color', 'stroke-width', 'arrow-style'],
  shape: ['stroke-color', 'fill-color', 'stroke-width'],
  note: ['fill-color', 'stroke-color', 'font-size'],
  text: ['stroke-color', 'font-size'],
  laser: ['stroke-color'],
};

/** Freehand drawing, shapes, notes, text, images and the laser pointer. */
export const whiteboard: Scene = {
  id: 'whiteboard',
  label: 'Whiteboard',
  mount({ stage }) {
    const shapeTool = new ShapeTool();
    const imageTool = new ImageTool();
    const viewport = new Viewport(stage, {
      ...VIEWPORT_OPTIONS,
      tools: [
        new SelectTool(),
        new HandTool(),
        new PencilTool(),
        new PencilTool({
          name: 'highlighter',
          width: 12,
          opacity: 0.4,
          blendMode: 'multiply',
          color: '#ffeb3b',
        }),
        new EraserTool(),
        new ArrowTool(),
        shapeTool,
        new NoteTool(),
        new TextTool(),
        imageTool,
        new LaserTool(),
      ],
    });

    // iOS Safari only delivers change events to a file input that is in the document.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('cancel', () => viewport.setTool('select'));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        viewport.setTool('select');
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result === 'string') imageTool.setSrc(reader.result);
      });
      reader.readAsDataURL(file);
      // Reset so picking the same file again still fires change.
      input.value = '';
    });
    const pickImage = (): void => input.click();

    const tools: readonly ToolSpec[] = [
      ...NAVIGATION_TOOLS,
      { name: 'pencil', label: 'Pencil', icon: 'pencil', key: '3' },
      { name: 'highlighter', label: 'Highlighter', icon: 'highlighter', key: '4' },
      { name: 'eraser', label: 'Eraser', icon: 'eraser', key: '5' },
      { name: 'arrow', label: 'Arrow', icon: 'arrow', key: '6' },
      {
        name: 'shape',
        label: 'Shape',
        icon: 'shape',
        key: '7',
        flyout: [
          {
            id: 'rectangle',
            label: 'Rectangle',
            icon: 'rectangle',
            select: () => shapeTool.setOptions({ shape: 'rectangle' }),
          },
          {
            id: 'ellipse',
            label: 'Ellipse',
            icon: 'ellipse',
            select: () => shapeTool.setOptions({ shape: 'ellipse' }),
          },
          {
            id: 'line',
            label: 'Line',
            icon: 'line',
            select: () => shapeTool.setOptions({ shape: 'line' }),
          },
        ],
      },
      { name: 'note', label: 'Note', icon: 'note', key: '8' },
      { name: 'text', label: 'Text', icon: 'text', key: '9' },
      { name: 'image', label: 'Image', icon: 'image', key: '0', beforeActivate: pickImage },
      { name: 'laser', label: 'Laser', icon: 'laser', key: 'l' },
    ];

    return {
      viewport,
      tools,
      styles: { controlsFor: (toolName) => CONTROLS[toolName] ?? [] },
      loadSample: () => {
        // This scene has no sample board yet.
      },
      dispose: () => {
        input.remove();
        viewport.destroy();
      },
    };
  },
};
