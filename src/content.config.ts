import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const products = defineCollection({
  loader: glob({ base: './src/content/products', pattern: '**/*.mdx' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    price: z.union([z.string(), z.number()]),
    image: z.string().optional(),
    description: z.any().optional(),
    status: z.string().optional(),
    badge: z.string().optional(),
    inStock: z.boolean().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    features: z.array(z.string()).optional(),
    specs: z
      .object({
        color: z.string().optional(),
        dimensions: z.string().optional(),
        weight: z.string().optional(),
        connection: z.string().optional(),
        warranty: z.string().optional()
      })
      .optional(),
    boxContents: z.array(z.string()).optional(),
    relatedProducts: z.array(z.string()).optional()
  })
});

const reviews = defineCollection({
  loader: glob({ base: './src/content/reviews', pattern: '**/*.mdx' }),
  schema: z.object({
    author: z.string(),
    text: z.any().optional(),
    rating: z.number().min(1).max(5)
  })
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.mdx' }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    body: z.any().optional()
  })
});

export const collections = {
  products,
  reviews,
  pages
};
