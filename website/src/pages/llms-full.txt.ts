import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readExamples } from '../lib/directives';
import { llmsFullTxt } from '../lib/llms';
import { repoFile } from '../lib/versions';

/** Every docs page as Markdown, in nav order. */
export const GET: APIRoute = async () =>
  new Response(
    llmsFullTxt(await getCollection('docs'), {
      examples: readExamples(repoFile('website', 'src', 'examples')),
      site: import.meta.env.SITE,
      base: import.meta.env.BASE_URL,
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
