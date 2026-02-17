import { defineConfig } from 'tinacms';

export default defineConfig({
  clientId: '728bd19e-e8c4-4186-aa72-6eab6290b3f1',
  branch: 'main',
  isLocalClient: false,
  token: process.env.TINA_TOKEN || '',
  backend: {
    type: 'github',
    repo: 'labekish/cryptoro',
    branch: 'main'
  } as any,
  build: {
    outputFolder: 'admin',
    publicFolder: 'public'
  },
  media: {
    tina: {
      mediaRoot: '',
      publicFolder: 'public'
    }
  },
  schema: {
    collections: [
      {
        name: 'products',
        label: 'Products',
        path: 'src/content/products',
        format: 'mdx',
        fields: [
          { type: 'string', name: 'title', label: 'Title', required: true },
          { type: 'string', name: 'slug', label: 'Slug' },
          { type: 'string', name: 'price', label: 'Price' },
          { type: 'image', name: 'image', label: 'Image' },
          { type: 'rich-text', name: 'description', label: 'Description' },
          {
            type: 'string',
            name: 'status',
            label: 'Status',
            options: ['НОВИНКА', 'PRO', 'PREDZAKAZ']
          },
          { type: 'string', name: 'features', label: 'Features', list: true }
        ]
      },
      {
        name: 'reviews',
        label: 'Reviews',
        path: 'src/content/reviews',
        format: 'mdx',
        fields: [
          { type: 'string', name: 'author', label: 'Author' },
          { type: 'rich-text', name: 'text', label: 'Text' },
          { type: 'number', name: 'rating', label: 'Rating', required: true }
        ]
      },
      {
        name: 'pages',
        label: 'Pages',
        path: 'src/content/pages',
        format: 'mdx',
        fields: [
          { type: 'string', name: 'slug', label: 'Slug' },
          { type: 'string', name: 'title', label: 'Title' },
          { type: 'rich-text', name: 'body', label: 'Body' }
        ]
      }
    ]
  }
});
