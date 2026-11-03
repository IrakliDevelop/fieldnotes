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
    let image: Blob | null;
    try {
      image = await exportImage({ scale: 1 });
    } catch (error) {
      console.error(error);
      window.alert('PNG export failed. Check the console for the error.');
      return;
    }
    if (!image) {
      window.alert('The board is empty, so there is no PNG to open. Draw something and try again.');
      return;
    }
    const url = URL.createObjectURL(image);
    const opened = window.open(url);
    if (!opened) {
      URL.revokeObjectURL(url);
      window.alert('The browser blocked the PNG tab. Allow pop-ups for this page and try again.');
      return;
    }
    opened.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  };

  return (
    <div className="toolbar">
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
      <button onClick={exportPng}>Open PNG</button>
    </div>
  );
}
