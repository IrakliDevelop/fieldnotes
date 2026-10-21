import type { Signal } from '@angular/core';
import { createSelectionSource } from '@fieldnotes/core';
import { injectSource } from './inject-source';

/** Selected element ids. Stable array reference — only changes when the selection changes. */
export function injectSelection(): Signal<string[]> {
  return injectSource(createSelectionSource, []);
}
