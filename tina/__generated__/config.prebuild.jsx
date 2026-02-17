// tina/config.ts
import { defineConfig } from "tinacms";
var config_default = defineConfig({
  branch: process.env.GITHUB_BRANCH || process.env.CF_PAGES_BRANCH || "main",
  clientId: process.env.TINA_CLIENT_ID || "728bd19e-e8c4-4186-aa72-6eab6290b3f1",
  token: process.env.TINA_TOKEN || "",
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        name: "products",
        label: "Products",
        path: "src/content/products",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", required: true },
          { type: "string", name: "slug", label: "Slug", required: true },
          { type: "number", name: "price", label: "Price", required: true },
          { type: "string", name: "badge", label: "Badge" },
          { type: "image", name: "image", label: "Image" },
          { type: "boolean", name: "inStock", label: "In stock" },
          { type: "string", name: "seoTitle", label: "SEO title" },
          { type: "string", name: "seoDescription", label: "SEO description" },
          {
            type: "string",
            name: "features",
            label: "Features",
            list: true
          },
          {
            type: "object",
            name: "specs",
            label: "Specs",
            fields: [
              { type: "string", name: "color", label: "Color" },
              { type: "string", name: "dimensions", label: "Dimensions" },
              { type: "string", name: "weight", label: "Weight" },
              { type: "string", name: "connection", label: "Connection" },
              { type: "string", name: "warranty", label: "Warranty" }
            ]
          },
          { type: "string", name: "boxContents", label: "Box contents", list: true },
          { type: "string", name: "relatedProducts", label: "Related products", list: true },
          { type: "rich-text", name: "body", label: "Description", isBody: true }
        ]
      },
      {
        name: "reviews",
        label: "Reviews",
        path: "src/content/reviews",
        format: "mdx",
        fields: [
          { type: "string", name: "author", label: "Author", required: true },
          {
            type: "number",
            name: "rating",
            label: "Rating",
            required: true,
            ui: {
              validate: (value) => {
                if (value < 1 || value > 5) return "Rating must be between 1 and 5";
              }
            }
          },
          { type: "rich-text", name: "body", label: "Text", isBody: true }
        ]
      },
      {
        name: "pages",
        label: "Pages",
        path: "src/content/pages",
        format: "mdx",
        fields: [
          { type: "string", name: "slug", label: "Slug", required: true },
          { type: "string", name: "title", label: "Title", required: true },
          { type: "rich-text", name: "body", label: "Body", isBody: true }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
