import {
  ImageTool,
  PencilTool,
  Viewport,
  createDefaultTools,
  type ShapeTool,
} from '@fieldnotes/core';

// #region choose
export function createImageBoard(container: HTMLElement): Viewport {
  return new Viewport(container, { tools: [...createDefaultTools(), new ImageTool()] });
}
// #endregion choose

// #region switch
export function bindToolButtons(viewport: Viewport, toolbar: HTMLElement): () => void {
  toolbar.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button?.dataset.tool) viewport.setTool(button.dataset.tool);
  });
  return viewport.toolManager.onChange((name) => {
    for (const button of toolbar.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === name));
    }
  });
}
// #endregion switch

// #region options
export function setUpPens(viewport: Viewport): void {
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
}
// #endregion options

// #region shortcuts
export function createKeyboardBoard(container: HTMLElement): Viewport {
  const viewport = new Viewport(container, {
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
  return viewport;
}
// #endregion shortcuts
