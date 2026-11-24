import type { APIRoute } from 'astro';
import { robotsTxt } from '../lib/sitemap';

/** The crawler rules, naming the sitemap. */
export const GET: APIRoute = () =>
  new Response(robotsTxt({ site: import.meta.env.SITE, base: import.meta.env.BASE_URL }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
