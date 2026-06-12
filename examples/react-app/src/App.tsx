import { useState } from 'react';
import { FieldNotesCanvas } from '@fieldnotes/react';
import {
  HandTool,
  SelectTool,
  PencilTool,
  EraserTool,
  NoteTool,
  ShapeTool,
} from '@fieldnotes/core';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { SaveControls } from './SaveControls';
import { StampTool } from './StampTool';

const TOOLS = [
  new HandTool(),
  new SelectTool(),
  new PencilTool(),
  new EraserTool(),
  new NoteTool(),
  new ShapeTool(),
  new StampTool(),
];

export function App() {
  const [tool, setTool] = useState('select');

  return (
    <div className="canvas-wrap">
      <FieldNotesCanvas
        tools={TOOLS}
        tool={tool}
        onToolChange={setTool}
        snapToGrid={false}
        style={{ width: '100%', height: '100%' }}
        options={{
          onImageError: ({ src }) => window.alert(`Image failed to load: ${src}`),
        }}
      >
        <Toolbar tool={tool} onSelect={setTool} />
        <SaveControls />
        <Sidebar />
      </FieldNotesCanvas>
    </div>
  );
}
