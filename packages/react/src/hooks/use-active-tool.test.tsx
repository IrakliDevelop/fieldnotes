import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useActiveTool } from './use-active-tool';
import { HandTool, SelectTool } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

describe('useActiveTool', () => {
  afterEach(cleanup);

  it('returns the current tool name as first element', () => {
    let toolName = '';
    function Consumer() {
      const [name] = useActiveTool();
      toolName = name;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool(), new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');
  });

  it('returns a setTool function as second element', () => {
    let setTool: ((name: string) => void) | null = null;
    let toolName = '';
    function Consumer() {
      const result = useActiveTool();
      toolName = result[0];
      setTool = result[1];
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool(), new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');
    expect(typeof setTool).toBe('function');

    act(() => {
      setTool?.('hand');
    });
    expect(toolName).toBe('hand');
  });

  it('updates when tool changes externally', () => {
    let toolName = '';
    let vp: Viewport | null = null;
    function Consumer() {
      const [name] = useActiveTool();
      toolName = name;
      return null;
    }

    render(
      <FieldNotesCanvas
        tools={[new HandTool(), new SelectTool()]}
        defaultTool="select"
        onReady={(v) => {
          vp = v;
        }}
      >
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');

    act(() => {
      vp?.toolManager.setTool('hand', vp.toolContext);
    });
    expect(toolName).toBe('hand');
  });
});
