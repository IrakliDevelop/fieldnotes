import { generateNKeysBetween, isValidIndexKey } from './fractional-index';

function legacyZ(element: Record<string, unknown> | undefined): number {
  const z = element?.['zIndex'];
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/** Gives pre-F1 elements order keys (by zIndex, then position) and a version, dropping zIndex. */
export function assignLegacyOrder<T extends Record<string, unknown>>(elements: readonly T[]): T[] {
  let maxIndex: string | null = null;
  const unplaced: number[] = [];
  elements.forEach((element, position) => {
    const index = element['index'];
    if (typeof index !== 'string' || !isValidIndexKey(index)) unplaced.push(position);
    else if (maxIndex === null || index > maxIndex) maxIndex = index;
  });
  unplaced.sort((x, y) => legacyZ(elements[x]) - legacyZ(elements[y]) || x - y);
  const keys = generateNKeysBetween(maxIndex, null, unplaced.length);
  const result = [...elements];
  unplaced.forEach((position, i) => {
    const element = elements[position];
    if (element === undefined) return;
    const version = element['version'];
    const upgraded = Object.assign({}, element, {
      index: keys[i] ?? '',
      version: Number.isSafeInteger(version) && Number(version) >= 1 ? version : 1,
    });
    delete upgraded['zIndex'];
    result[position] = upgraded;
  });
  return result;
}
