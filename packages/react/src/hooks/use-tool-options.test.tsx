import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { useToolOptions } from './use-tool-options';
import { PencilTool, HandTool } from '@fieldnotes/core';
import type { PencilToolOptions } from '@fieldnotes/core';

describe('useToolOptions', () => {
  afterEach(cleanup);

  it('returns current tool options', () => {
    const pencil = new PencilTool({ color: '#ff0000', width: 5 });
    let options: PencilToolOptions | null = null;

    function Consumer() {
      const [opts] = useToolOptions<PencilToolOptions>('pencil');
      options = opts;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[pencil]} defaultTool="pencil">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(options).toEqual({
      color: '#ff0000',
      width: 5,
      smoothing: 1.5,
      minPointDistance: 3,
      progressiveSimplifyThreshold: 200,
    });
  });

  it('returns null for tools without getOptions', () => {
    let options: Record<string, unknown> | null = null;

    function Consumer() {
      const [opts] = useToolOptions('hand');
      options = opts;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool()]} defaultTool="hand">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(options).toBeNull();
  });

  it('returns null for non-existent tool', () => {
    let options: Record<string, unknown> | null = null;

    function Consumer() {
      const [opts] = useToolOptions('nonexistent');
      options = opts;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool()]} defaultTool="hand">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(options).toBeNull();
  });

  it('updates when setOptions is called via the hook', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    let options: PencilToolOptions | null = null;
    let setOpts: ((opts: Partial<PencilToolOptions>) => void) | null = null;

    function Consumer() {
      const [opts, set] = useToolOptions<PencilToolOptions>('pencil');
      options = opts;
      setOpts = set;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[pencil]} defaultTool="pencil">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(options?.color).toBe('#ff0000');

    act(() => {
      setOpts?.({ color: '#00ff00' });
    });
    expect(options?.color).toBe('#00ff00');
  });

  it('updates when setOptions is called externally on the tool', () => {
    const pencil = new PencilTool({ color: '#ff0000' });
    let options: PencilToolOptions | null = null;

    function Consumer() {
      const [opts] = useToolOptions<PencilToolOptions>('pencil');
      options = opts;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[pencil]} defaultTool="pencil">
        <Consumer />
      </FieldNotesCanvas>,
    );
    expect(options?.color).toBe('#ff0000');

    act(() => {
      pencil.setOptions({ color: '#0000ff' });
    });
    expect(options?.color).toBe('#0000ff');
  });

  it('setOptions is a no-op for tools without setOptions', () => {
    let setOpts: ((opts: Partial<Record<string, unknown>>) => void) | null = null;

    function Consumer() {
      const [, set] = useToolOptions('hand');
      setOpts = set;
      return null;
    }

    render(
      <FieldNotesCanvas tools={[new HandTool()]} defaultTool="hand">
        <Consumer />
      </FieldNotesCanvas>,
    );

    expect(() => setOpts?.({})).not.toThrow();
  });
});
