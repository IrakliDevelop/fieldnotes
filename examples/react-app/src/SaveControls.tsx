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
    try {
      const image = await exportImage({ scale: 1 });
      if (!image) throw new Error('PNG export failed');
      const url = URL.createObjectURL(image);
      const opened = window.open(url);
      if (!opened) {
        URL.revokeObjectURL(url);
        throw new Error('PNG tab blocked');
      }
      opened.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    } catch {
      window.alert('The browser blocked the PNG tab. Allow pop-ups for this page and try again.');
    }
  };

  return (
    <div className="toolbar">
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
      <button onClick={exportPng}>Open PNG</button>
    </div>
  );
}
