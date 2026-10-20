import { createNote, type Viewport } from '@fieldnotes/core';

export function undoButtons(viewport: Viewport): void {
  // #region buttons
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const undo = document.querySelector<HTMLButtonElement>('#undo')!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const redo = document.querySelector<HTMLButtonElement>('#redo')!;
  undo.addEventListener('click', () => viewport.undo());
  redo.addEventListener('click', () => viewport.redo());
  const update = (): void => {
    undo.disabled = !viewport.history.canUndo;
    redo.disabled = !viewport.history.canRedo;
  };
  update();
  viewport.history.onChange(update);
  // #endregion buttons
}

export function labelledBox(viewport: Viewport): void {
  // #region transaction
  viewport.transaction(() => {
    viewport.addShape({ position: { x: 0, y: 0 }, size: { w: 240, h: 160 } });
    viewport.store.add(
      createNote({
        position: { x: 20, y: 20 },
        text: 'Room 1',
        layerId: viewport.layerManager.activeLayerId,
      }),
    );
  });
  // #endregion transaction
}

export function serverNote(viewport: Viewport): void {
  // #region origin
  const note = createNote({
    position: { x: 0, y: -140 },
    text: 'Saved on the server',
    layerId: viewport.layerManager.activeLayerId,
  });
  viewport.store.add(note, { origin: 'remote' });
  // #endregion origin
}
