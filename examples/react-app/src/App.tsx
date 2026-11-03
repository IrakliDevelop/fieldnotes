import { useState } from 'react';
import { FieldNotesCanvas, HostElement } from '@fieldnotes/react';
import type { Viewport } from '@fieldnotes/react';
import { createDefaultTools } from '@fieldnotes/core';
import { CameraBar } from './CameraBar';
import { Card } from './Card';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { SaveControls } from './SaveControls';
import { StampTool } from './StampTool';

const TOOLS = [...createDefaultTools(), new StampTool()];
const TOOLS_WITHOUT_STAMP = TOOLS.filter((tool) => tool.name !== 'stamp');
const AUTO_SAVE = { key: 'fieldnotes-react-example' };
const SHORTCUTS = { 'edit.undo': ['mod+z', 'mod+u'] };
const ACTIVATION = { gesture: 'single' } as const;
const HOST_POSITION = { x: 40, y: 320 };
const HOST_SIZE = { w: 220, h: 80 };

declare global {
  interface Window {
    __fieldnotes_viewport?: Viewport;
  }
}

export function App() {
  const [tool, setTool] = useState('select');
  const [hasStamp, setHasStamp] = useState(true);
  const [lastActivated, setLastActivated] = useState<string>();

  return (
    <div className="canvas-wrap">
      <FieldNotesCanvas
        tools={hasStamp ? TOOLS : TOOLS_WITHOUT_STAMP}
        tool={tool}
        onToolChange={setTool}
        autoSave={AUTO_SAVE}
        shortcuts={SHORTCUTS}
        activation={ACTIVATION}
        onElementActivate={(event) => setLastActivated(event.element.id)}
        onReady={(viewport) => {
          window.__fieldnotes_viewport = viewport;
        }}
        style={{ width: '100%', height: '100%' }}
        options={{
          onImageError: ({ src }) => window.alert(`Image failed to load: ${src}`),
        }}
      >
        <Toolbar tool={tool} onSelect={setTool} hasStamp={hasStamp} />
        <SaveControls />
        <CameraBar />
        <Sidebar />
        <div className="toolbar" style={{ top: 116 }}>
          <label>
            <input
              type="checkbox"
              checked={hasStamp}
              onChange={(event) => setHasStamp(event.target.checked)}
            />
            Stamp tool
          </label>
          <p>Last activated: {lastActivated ?? 'none'}</p>
        </div>
        <HostElement position={HOST_POSITION} size={HOST_SIZE}>
          <Card />
        </HostElement>
      </FieldNotesCanvas>
    </div>
  );
}
