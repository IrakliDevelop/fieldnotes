import { createNote, type Viewport } from '@fieldnotes/core';

// #region buttons
export function bindUndoButtons(
  viewport: Viewport,
  undo: HTMLButtonElement,
  redo: HTMLButtonElement,
): () => void {
  undo.addEventListener('click', () => viewport.undo());
  redo.addEventListener('click', () => viewport.redo());
  const update = (): void => {
    undo.disabled = !viewport.history.canUndo;
    redo.disabled = !viewport.history.canRedo;
  };
  update();
  return viewport.history.onChange(update);
}
// #endregion buttons

// #region transaction
export function addLabelledBox(viewport: Viewport, label: string): void {
  viewport.transaction(() => {
    viewport.addShape({ position: { x: 0, y: 0 }, size: { w: 240, h: 160 } });
    viewport.store.add(
      createNote({
        position: { x: 20, y: 20 },
        text: label,
        layerId: viewport.layerManager.activeLayerId,
      }),
    );
  });
}
// #endregion transaction

// #region origin
export function showServerNote(viewport: Viewport, text: string): void {
  const note = createNote({
    position: { x: 0, y: -140 },
    text,
    layerId: viewport.layerManager.activeLayerId,
  });
  viewport.store.add(note, { origin: 'remote' });
}
// #endregion origin
