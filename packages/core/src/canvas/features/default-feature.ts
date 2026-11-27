import type { PaletteOptions } from '../palette-model';
import type { ViewportPlugin } from '../viewport-plugin';
import { paletteFeature } from './palette-feature';
import { presentationFeature } from './presentation-feature';

/** The features `Viewport` turned on by default: the palette with shortcuts help, and presentation. */
export function defaultFeatures(options?: { palette?: PaletteOptions }): ViewportPlugin[] {
  return [paletteFeature(options?.palette), presentationFeature()];
}
