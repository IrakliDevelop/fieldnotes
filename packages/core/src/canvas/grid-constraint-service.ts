import type { Point } from '../core/types';
import type {
  ConstraintOptions,
  ConstraintInfo,
  PointConstraintService,
} from '../core/constraint-service';
import type { GridInfo } from './grid-controller';
import { snapPoint, snapToHexCenter, snapToCellCenter } from '../core/snap';
import type { Footprint } from '../core/snap';

export class GridConstraintService implements PointConstraintService {
  constructor(private readonly getGridInfo: () => GridInfo | null) {}

  readonly constrainPoint = (point: Point, options?: ConstraintOptions): Point => {
    const info = this.getGridInfo();
    if (!info) return point;

    if (info.gridType === 'hex') {
      return snapToHexCenter(point, info.cellSize, info.hexOrientation);
    }

    if (options?.mode === 'cell-center' || options?.footprint) {
      const footprint: Footprint = options?.footprint ?? 1;
      return snapToCellCenter(point, info.cellSize, footprint);
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
