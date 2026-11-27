import type { ExportDefaults } from './viewport';

/** Anything the export functions can read a store, layers and option defaults from. */
export interface ExportSource {
  exportDefaults(): ExportDefaults;
}

export function isExportSource(x: unknown): x is ExportSource {
  return (
    typeof x === 'object' &&
    x !== null &&
    'exportDefaults' in x &&
    typeof x.exportDefaults === 'function'
  );
}
