import { InjectionToken } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Viewport } from '@fieldnotes/core';

/** Viewport signal provided by `<fn-canvas>`; a host may provide its own. */
export const FIELDNOTES_VIEWPORT = new InjectionToken<Signal<Viewport | null>>(
  'FIELDNOTES_VIEWPORT',
);
