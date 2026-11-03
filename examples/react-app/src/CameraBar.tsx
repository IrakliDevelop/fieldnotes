import { useCameraControls, useCanvasSize, useShortcuts } from '@fieldnotes/react';

export function CameraBar() {
  const { animateTo, fitToContent, setZoom } = useCameraControls();
  const { w, h } = useCanvasSize();
  const { bindings } = useShortcuts();
  const undoBindings = bindings['edit.undo'] ?? [];

  return (
    <div className="toolbar" style={{ top: 168 }}>
      <button onClick={() => fitToContent()}>Fit</button>
      <button onClick={() => setZoom(2)}>Zoom 2×</button>
      <button onClick={() => animateTo({ x: 0, y: 0, w: 400, h: 300 })}>Animate to origin</button>
      <span>
        {w}×{h}
      </span>
      <span>{undoBindings.join(', ')}</span>
    </div>
  );
}
