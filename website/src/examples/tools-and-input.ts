import {
  ImageTool,
  PencilTool,
  Viewport,
  createDefaultTools,
  type ShapeTool,
} from '@fieldnotes/core';

export function chooseTools(): Viewport {
  // #region choose
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    tools: [...createDefaultTools(), new ImageTool()],
  });
  // #endregion choose
  return viewport;
}

export function toolButtons(viewport: Viewport): void {
  // #region switch
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const toolbar = document.getElementById('toolbar')!;
  toolbar.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button?.dataset.tool) viewport.setTool(button.dataset.tool);
  });
  viewport.toolManager.onChange((name) => {
    for (const button of toolbar.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === name));
    }
  });
  // #endregion switch
}

export function pens(viewport: Viewport): void {
  // #region options
  viewport.toolManager.getTool<PencilTool>('pencil')?.setOptions({ color: '#2F55A4', width: 3 });
  viewport.toolManager.getTool<ShapeTool>('shape')?.setOptions({ shape: 'ellipse' });

  viewport.toolManager.register(
    new PencilTool({
      name: 'highlighter',
      color: '#F2DE8A',
      width: 12,
      opacity: 0.4,
      blendMode: 'multiply',
    }),
  );
  // #endregion options
}

export function keyboardBoard(): void {
  // #region shortcuts
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    tools: 'default',
    shortcuts: {
      bindings: {
        'edit.duplicate': 'mod+shift+d',
        'tool.pencil': ['p', 'b'],
      },
    },
  });
  viewport.shortcuts.disable('select.cycle');
  viewport.shortcuts.disable('select.cycle-reverse');
  // #endregion shortcuts
}
