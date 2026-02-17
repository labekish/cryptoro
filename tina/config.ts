import { defineConfig } from 'tinacms';

const tinaToken = process.env.TINA_TOKEN;

export default defineConfig({
  branch: process.env.GITHUB_BRANCH || process.env.CF_PAGES_BRANCH || 'main',
  clientId: process.env.TINA_CLIENT_ID || '728bd19e-e8c4-4186-aa72-6eab6290b3f1',
  isLocalClient: false,
  ...(tinaToken ? { token: tinaToken } : {}),
  build: {
    outputFolder: 'admin',
    publicFolder: 'public'
  },
  media: {
    tina: {
      mediaRoot: 'images/products',
      publicFolder: 'public'
    }
  },
  schema: {
    collections: [
      {
        name: 'products',
        label: 'Товары',
        path: 'src/content/products',
        format: 'mdx',
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.slug || values?.title || 'product')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
            }
          }
        },
        fields: [
          { type: 'string', name: 'title', label: 'Название', required: true },
          { type: 'string', name: 'slug', label: 'Slug (латиницей)', required: true },
          {
            type: 'number',
            name: 'price',
            label: 'Цена',
            required: true,
            ui: {
              validate: (value) => {
                if (value == null || Number(value) <= 0) return 'Цена должна быть больше 0';
              }
            }
          },
          { type: 'string', name: 'badge', label: 'Бейдж' },
          {
            type: 'image',
            name: 'image',
            label: 'Изображение'
          },
          { type: 'boolean', name: 'inStock', label: 'В наличии' },
          { type: 'string', name: 'seoTitle', label: 'SEO заголовок' },
          { type: 'string', name: 'seoDescription', label: 'SEO описание' },
          {
            type: 'string',
            name: 'features',
            label: 'Преимущества',
            list: true
          },
          {
            type: 'object',
            name: 'specs',
            label: 'Характеристики',
            fields: [
              { type: 'string', name: 'color', label: 'Цвет' },
              { type: 'string', name: 'dimensions', label: 'Размеры' },
              { type: 'string', name: 'weight', label: 'Вес' },
              { type: 'string', name: 'connection', label: 'Подключение' },
              { type: 'string', name: 'warranty', label: 'Гарантия' }
            ]
          },
          { type: 'string', name: 'boxContents', label: 'Комплектация', list: true },
          { type: 'string', name: 'relatedProducts', label: 'Похожие товары (slug)', list: true },
          { type: 'rich-text', name: 'body', label: 'Описание', isBody: true }
        ]
      },
      {
        name: 'reviews',
        label: 'Отзывы',
        path: 'src/content/reviews',
        format: 'mdx',
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.author || 'review')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
            }
          }
        },
        fields: [
          { type: 'string', name: 'author', label: 'Автор', required: true },
          {
            type: 'number',
            name: 'rating',
            label: 'Рейтинг',
            required: true,
            ui: {
              validate: (value) => {
                if (value < 1 || value > 5) return 'Рейтинг должен быть от 1 до 5';
              }
            }
          },
          { type: 'rich-text', name: 'body', label: 'Текст отзыва', isBody: true }
        ]
      },
      {
        name: 'pages',
        label: 'Страницы',
        path: 'src/content/pages',
        format: 'mdx',
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.slug || values?.title || 'page')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
            }
          }
        },
        fields: [
          { type: 'string', name: 'slug', label: 'Slug (латиницей)', required: true },
          { type: 'string', name: 'title', label: 'Заголовок', required: true },
          { type: 'rich-text', name: 'body', label: 'Контент', isBody: true }
        ]
      }
    ]
  }
});
