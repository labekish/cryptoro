// tina/config.ts
import { defineConfig } from "tinacms";
var config_default = defineConfig({
  clientId: "728bd19e-c4-4186-aa72-6eab6290b3f1",
  branch: "main",
  // Tina Cloud Git backend settings requested for this repo.
  backend: {
    type: "github",
    repo: "labekish/cryptoro",
    branch: "main"
  },
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
        format: "md",
        fields: [
          { type: "string", name: "title", label: "Title" },
          { type: "string", name: "slug", label: "Slug" },
          { type: "string", name: "price", label: "Price" },
          { type: "image", name: "image", label: "Image" },
          { type: "rich-text", name: "description", label: "Description" },
          { type: "string", name: "status", label: "Status" },
          { type: "string", name: "features", label: "Features", list: true }
        ]
      },
      {
        name: "reviews",
        label: "Reviews",
        path: "src/content/reviews",
        format: "md",
        fields: [
          { type: "string", name: "author", label: "Author" },
          { type: "rich-text", name: "text", label: "Text" },
          { type: "number", name: "rating", label: "Rating" }
        ]
      },
      {
        name: "pages",
        label: "Pages",
        path: "src/content/pages",
        format: "md",
        fields: [
          { type: "string", name: "slug", label: "Slug" },
          { type: "string", name: "title", label: "Title" },
          { type: "rich-text", name: "body", label: "Body" }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
