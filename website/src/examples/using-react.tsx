import type { CanvasState } from '@fieldnotes/core';
import { FieldNotesCanvas, useActiveTool } from '@fieldnotes/react';

// #region app
const saved = localStorage.getItem('board') ?? undefined;
const save = (state: CanvasState) => localStorage.setItem('board', JSON.stringify(state));

export function App() {
  return (
    <FieldNotesCanvas initialData={saved} onChange={save} style={{ height: '100vh' }}>
      <PencilButton />
    </FieldNotesCanvas>
  );
}
// #endregion app

// #region tool-button
function PencilButton() {
  const [tool, setTool] = useActiveTool();
  return (
    <button type="button" aria-pressed={tool === 'pencil'} onClick={() => setTool('pencil')}>
      Pencil
    </button>
  );
}
// #endregion tool-button
