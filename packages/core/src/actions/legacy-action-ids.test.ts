import { describe, it, expect } from 'vitest';

import { LEGACY_ACTION_IDS, resolveActionId } from './legacy-action-ids';

describe('legacy action ids', () => {
  it('maps every legacy id to its canonical id', () => {
    const table: Record<string, string> = {
      undo: 'edit.undo',
      redo: 'edit.redo',
      cut: 'edit.cut',
      copy: 'edit.copy',
      paste: 'edit.paste',
      duplicate: 'edit.duplicate',
      delete: 'edit.delete',
      'select-all': 'select.all',
      deselect: 'select.none',
      'cycle-selection': 'select.cycle',
      'cycle-selection-reverse': 'select.cycle-reverse',
      'z-front': 'arrange.bring-to-front',
      'z-forward': 'arrange.bring-forward',
      'z-backward': 'arrange.send-backward',
      'z-back': 'arrange.send-to-back',
      group: 'arrange.group',
      ungroup: 'arrange.ungroup',
      'toggle-lock': 'arrange.toggle-lock',
      'rotate-cw': 'arrange.rotate-cw',
      'rotate-ccw': 'arrange.rotate-ccw',
      'nudge-left': 'arrange.nudge-left',
      'nudge-right': 'arrange.nudge-right',
      'nudge-up': 'arrange.nudge-up',
      'nudge-down': 'arrange.nudge-down',
      'zoom-in': 'view.zoom-in',
      'zoom-out': 'view.zoom-out',
      'zoom-reset': 'view.zoom-reset',
      'zoom-fit': 'view.zoom-to-fit',
      'tool:select': 'tool.select',
    };
    for (const [legacy, canonical] of Object.entries(table)) {
      expect(resolveActionId(legacy)).toBe(canonical);
    }
  });

  it('maps any tool: prefix', () => {
    expect(resolveActionId('tool:my-plugin-tool')).toBe('tool.my-plugin-tool');
  });

  it('returns canonical and unknown ids unchanged', () => {
    expect(resolveActionId('edit.undo')).toBe('edit.undo');
    expect(resolveActionId('x.y')).toBe('x.y');
  });

  it('LEGACY_ACTION_IDS has exactly 28 exact entries', () => {
    expect(Object.keys(LEGACY_ACTION_IDS)).toHaveLength(28);
  });

  it('ignores Object.prototype keys', () => {
    expect(resolveActionId('toString')).toBe('toString');
    expect(typeof resolveActionId('toString')).toBe('string');
    expect(resolveActionId('constructor')).toBe('constructor');
    expect(typeof resolveActionId('constructor')).toBe('string');
    expect(resolveActionId('hasOwnProperty')).toBe('hasOwnProperty');
    expect(typeof resolveActionId('hasOwnProperty')).toBe('string');
  });
});
