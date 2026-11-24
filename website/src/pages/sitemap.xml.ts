import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { orderDocs } from '../lib/docs-nav';
import { sitePaths, sitemapXml } from '../lib/sitemap';

/** The sitemap of every indexable page. */
export const GET: APIRoute = async () =>
  new Response(
    sitemapXml(sitePaths(orderDocs(await getCollection('docs')).map((entry) => entry.id)), {
      site: import.meta.env.SITE,
      base: import.meta.env.BASE_URL,
    }),
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
