import { useExport, useLoad } from '@fieldnotes/react';

export function SaveControls() {
  const { exportImage, exportJSON } = useExport();
  const loadState = useLoad();

  const save = () => {
    localStorage.setItem('fieldnotes-example', exportJSON());
  };
  const load = () => {
    const json = localStorage.getItem('fieldnotes-example');
    if (json) loadState(json);
  };
  const exportPng = async () => {
    const image = await exportImage({ scale: 1 });
    if (!image) return;
    const url = URL.createObjectURL(image);
    const opened = window.open(url);
    if (!opened) {
      URL.revokeObjectURL(url);
      return;
    }
    opened.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  };

  return (
    <div className="toolbar" style={{ top: 64 }}>
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
      <button onClick={exportPng}>PNG</button>
    </div>
  );
}
