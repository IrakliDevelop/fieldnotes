import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { llmsTxt } from '../lib/llms';

/** The docs index for language models. */
export const GET: APIRoute = async () =>
  new Response(
    llmsTxt(await getCollection('docs'), {
      site: import.meta.env.SITE,
      base: import.meta.env.BASE_URL,
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
