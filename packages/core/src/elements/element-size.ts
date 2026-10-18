import type { Size } from '../core/types';
import type { CanvasElement } from './types';

export function hasSize(el: CanvasElement): el is CanvasElement & { size: Size } {
  return 'size' in el && el.size !== undefined;
}
