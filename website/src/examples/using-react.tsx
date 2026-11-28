import { useMemo } from 'react';
import { createDefaultTools, defaultFeatures, type CanvasState } from '@fieldnotes/core';
import { FieldNotesCanvas, useActiveTool, useShortcuts } from '@fieldnotes/react';

// #region app
const saved = localStorage.getItem('board') ?? undefined;
const save = (state: CanvasState) => localStorage.setItem('board', JSON.stringify(state));

export function App() {
  // Tools and plugins belong to one canvas, so each component creates its own.
  const tools = useMemo(() => createDefaultTools(), []);
  const options = useMemo(() => ({ plugins: defaultFeatures() }), []);
  return (
    <FieldNotesCanvas
      tools={tools}
      options={options}
      initialData={saved}
      onChange={save}
      style={{ height: '100vh' }}
    >
      <PencilButton />
    </FieldNotesCanvas>
  );
}
// #endregion app

// #region autosave
export function AutoSaveApp() {
  const tools = useMemo(() => createDefaultTools(), []);
  const options = useMemo(() => ({ plugins: defaultFeatures() }), []);
  return (
    <FieldNotesCanvas
      tools={tools}
      options={options}
      autoSave={{ key: 'board' }}
      style={{ height: '100vh' }}
    />
  );
}
// #endregion autosave

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

// #region shortcuts
export function UndoShortcut() {
  const { bindings } = useShortcuts();
  return <span>{bindings['edit.undo']?.join(', ') ?? ''}</span>;
}
// #endregion shortcuts
