import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from 'astro';
import { getCollection } from 'astro:content';
import { readExamples } from '../../lib/directives';
import { toMarkdownTwin } from '../../lib/llms';
import { repoFile } from '../../lib/versions';

export const getStaticPaths = (async () =>
  (await getCollection('docs')).map((entry) => ({
    params: { slug: entry.id },
    props: { entry },
  }))) satisfies GetStaticPaths;

/** The Markdown twin of a docs page. */
export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) =>
  new Response(
    toMarkdownTwin(
      { ...props.entry.data, body: props.entry.body ?? '' },
      {
        examples: readExamples(repoFile('website', 'src', 'examples')),
        site: import.meta.env.SITE,
        base: import.meta.env.BASE_URL,
      },
    ),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  );
