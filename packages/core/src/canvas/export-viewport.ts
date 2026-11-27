import type { ExportDefaults } from './viewport';

/** Anything the export functions can read a store, layers and option defaults from. */
export interface ExportSource {
  exportDefaults(): ExportDefaults;
}
