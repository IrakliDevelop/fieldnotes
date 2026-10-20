import { withBase } from '../lib/paths';

/** Prefixes a site path with the configured Astro base. */
export const link = (path: string): string => withBase(path, import.meta.env.BASE_URL);
