import { useViewport } from '@fieldnotes/react';

export function SaveControls() {
  const viewport = useViewport();

  const save = () => {
    localStorage.setItem('fieldnotes-example', viewport.exportJSON());
  };
  const load = () => {
    const json = localStorage.getItem('fieldnotes-example');
    if (json) viewport.loadJSON(json);
  };

  return (
    <div className="toolbar" style={{ top: 64 }}>
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
    </div>
  );
}
