import { useCallback } from 'react';
import { useElements, useHistory } from '@fieldnotes/react';
import type { CanvasElement } from '@fieldnotes/core';

export function Sidebar() {
  const count = useElements(useCallback((els: CanvasElement[]) => els.length, []));
  const notes = useElements('note');
  const { canUndo, canRedo, undo, redo } = useHistory();

  return (
    <div className="sidebar">
      <h3>Board</h3>
      <p>{count} elements</p>
      <button onClick={undo} disabled={!canUndo}>
        Undo
      </button>{' '}
      <button onClick={redo} disabled={!canRedo}>
        Redo
      </button>
      <h4>Notes</h4>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.text ? n.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)'}</li>
        ))}
      </ul>
    </div>
  );
}
