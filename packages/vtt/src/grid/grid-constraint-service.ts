import type {
  Point,
  ConstraintOptions,
  ConstraintInfo,
  PointConstraintService,
} from '@fieldnotes/core';
import { snapPoint, snapToHexCenter, snapToCellCenter } from './snap';
import type { Footprint } from './snap';
import type { GridInfo } from './grid-controller';

export class GridConstraintService implements PointConstraintService {
  constructor(private readonly getGridInfo: () => GridInfo | null) {}

  readonly constrainPoint = (point: Point, options?: ConstraintOptions): Point => {
    const info = this.getGridInfo();
    if (!info) return point;

    if (info.gridType === 'hex') {
      return snapToHexCenter(point, info.cellSize, info.hexOrientation);
    }

    // Derive a footprint from element pixel dimensions so callers do not
    // need to know the grid cell size.
    let footprint: Footprint | undefined;
    if (options?.footprint) {
      footprint = { w: options.footprint.width, h: options.footprint.height };
    } else if (options?.elementSize && info.cellSize > 0) {
      footprint = {
        w: Math.max(1, Math.round(options.elementSize.w / info.cellSize)),
        h: Math.max(1, Math.round(options.elementSize.h / info.cellSize)),
      };
    }

    if (options?.mode === 'cell-center' || footprint) {
      return snapToCellCenter(point, info.cellSize, footprint ?? 1);
    }

    return snapPoint(point, info.cellSize);
  };

  readonly getConstraintInfo = (): ConstraintInfo | null => {
    const info = this.getGridInfo();
    if (!info) return null;
    return {
      type: info.gridType,
      gridType: info.gridType,
      cellSize: info.cellSize,
      hexOrientation: info.hexOrientation,
      snapStep: info.cellSize,
      nudgeStep: info.cellSize,
    };
  };

  readonly hasCapability = (capability: string): boolean => {
    const info = this.getGridInfo();
    if (!info) return false;
    switch (capability) {
      case 'grid:snap':
        return true;
      case 'grid:square':
        return info.gridType === 'square';
      case 'grid:hex':
        return info.gridType === 'hex';
      case 'grid:cell-center':
        return info.gridType === 'square';
      case 'grid:footprint':
        return info.gridType === 'square';
      default:
        return false;
    }
  };
}
