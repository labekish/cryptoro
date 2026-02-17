// tina/config.ts
import { defineConfig } from "tinacms";
var viteEnv = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
var nodeEnv = typeof globalThis !== "undefined" && globalThis.process?.env ? globalThis.process?.env : {};
var getEnv = (key) => viteEnv[key] ?? nodeEnv[key];
var tinaToken = getEnv("TINA_TOKEN");
var config_default = defineConfig({
  branch: getEnv("GITHUB_BRANCH") || getEnv("CF_PAGES_BRANCH") || "main",
  clientId: getEnv("PUBLIC_TINA_CLIENT_ID") || getEnv("TINA_CLIENT_ID") || "728bd19e-e8c4-4186-aa72-6eab6290b3f1",
  isLocalClient: false,
  ...tinaToken ? { token: tinaToken } : {},
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  media: {
    tina: {
      mediaRoot: "images/products",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        name: "products",
        label: "\u0422\u043E\u0432\u0430\u0440\u044B",
        path: "src/content/products",
        format: "mdx",
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.slug || values?.title || "product").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
            }
          }
        },
        fields: [
          { type: "string", name: "title", label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", required: true },
          { type: "string", name: "slug", label: "Slug (\u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0435\u0439)", required: true },
          {
            type: "number",
            name: "price",
            label: "\u0426\u0435\u043D\u0430",
            required: true,
            ui: {
              validate: (value) => {
                if (value == null || Number(value) <= 0) return "\u0426\u0435\u043D\u0430 \u0434\u043E\u043B\u0436\u043D\u0430 \u0431\u044B\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 0";
              }
            }
          },
          { type: "string", name: "badge", label: "\u0411\u0435\u0439\u0434\u0436" },
          {
            type: "image",
            name: "image",
            label: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435"
          },
          { type: "boolean", name: "inStock", label: "\u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438" },
          { type: "string", name: "seoTitle", label: "SEO \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A" },
          { type: "string", name: "seoDescription", label: "SEO \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" },
          {
            type: "string",
            name: "features",
            label: "\u041F\u0440\u0435\u0438\u043C\u0443\u0449\u0435\u0441\u0442\u0432\u0430",
            list: true
          },
          {
            type: "object",
            name: "specs",
            label: "\u0425\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438",
            fields: [
              { type: "string", name: "color", label: "\u0426\u0432\u0435\u0442" },
              { type: "string", name: "dimensions", label: "\u0420\u0430\u0437\u043C\u0435\u0440\u044B" },
              { type: "string", name: "weight", label: "\u0412\u0435\u0441" },
              { type: "string", name: "connection", label: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" },
              { type: "string", name: "warranty", label: "\u0413\u0430\u0440\u0430\u043D\u0442\u0438\u044F" }
            ]
          },
          { type: "string", name: "boxContents", label: "\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0430\u0446\u0438\u044F", list: true },
          { type: "string", name: "relatedProducts", label: "\u041F\u043E\u0445\u043E\u0436\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u044B (slug)", list: true },
          { type: "rich-text", name: "body", label: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435", isBody: true }
        ]
      },
      {
        name: "reviews",
        label: "\u041E\u0442\u0437\u044B\u0432\u044B",
        path: "src/content/reviews",
        format: "mdx",
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.author || "review").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
            }
          }
        },
        fields: [
          { type: "string", name: "author", label: "\u0410\u0432\u0442\u043E\u0440", required: true },
          { type: "string", name: "role", label: "\u0420\u043E\u043B\u044C / \u0433\u043E\u0440\u043E\u0434" },
          {
            type: "number",
            name: "rating",
            label: "\u0420\u0435\u0439\u0442\u0438\u043D\u0433",
            required: true,
            ui: {
              validate: (value) => {
                if (value < 1 || value > 5) return "\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u043E\u0442 1 \u0434\u043E 5";
              }
            }
          },
          {
            type: "string",
            name: "text",
            label: "\u0422\u0435\u043A\u0441\u0442 \u043E\u0442\u0437\u044B\u0432\u0430",
            required: true
          }
        ]
      },
      {
        name: "pages",
        label: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u044B",
        path: "src/content/pages",
        format: "mdx",
        ui: {
          filename: {
            readonly: true,
            slugify: (values) => {
              return String(values?.slug || values?.title || "page").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
            }
          }
        },
        fields: [
          { type: "string", name: "slug", label: "Slug (\u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0435\u0439)", required: true },
          { type: "string", name: "title", label: "\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A", required: true },
          { type: "string", name: "heroTitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A hero" },
          { type: "string", name: "heroSubtitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u043F\u043E\u0434\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A hero" },
          { type: "string", name: "productsTitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u0441\u0435\u043A\u0446\u0438\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432" },
          { type: "string", name: "productsSubtitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u043F\u043E\u0434\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u0441\u0435\u043A\u0446\u0438\u0438 \u0442\u043E\u0432\u0430\u0440\u043E\u0432" },
          { type: "string", name: "reviewsTitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u043E\u0442\u0437\u044B\u0432\u043E\u0432" },
          { type: "string", name: "reviewsSubtitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u043F\u043E\u0434\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u043E\u0442\u0437\u044B\u0432\u043E\u0432" },
          { type: "string", name: "leadTitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u0438" },
          { type: "string", name: "leadSubtitle", label: "\u0413\u043B\u0430\u0432\u043D\u0430\u044F: \u043F\u043E\u0434\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u0438" },
          {
            type: "string",
            name: "text",
            label: "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B"
          },
          { type: "rich-text", name: "body", label: "\u041A\u043E\u043D\u0442\u0435\u043D\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B", isBody: true }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
