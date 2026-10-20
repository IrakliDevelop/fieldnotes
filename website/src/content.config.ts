import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { DOC_GROUPS } from './lib/docs-nav';

/** Docs pages under `content/docs/`; the slug is the file name. */
export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: '*.md', base: './content/docs' }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      group: z.enum(DOC_GROUPS),
      order: z.number(),
      stub: z.boolean().optional(),
      readme: z.string().optional(),
    }),
  }),
};
