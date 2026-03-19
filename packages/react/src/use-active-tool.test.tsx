import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { useActiveTool } from './use-active-tool';
import { HandTool, SelectTool } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';

describe('useActiveTool', () => {
  afterEach(cleanup);

  it('returns the current tool name', () => {
    let toolName = '';
    function Consumer() {
      toolName = useActiveTool();
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool(), new SelectTool()]} defaultTool="select">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(toolName).toBe('select');
  });

  it('updates when tool changes', () => {
    let toolName = '';
    let vp: Viewport | null = null;
    function Consumer() {
      toolName = useActiveTool();
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
