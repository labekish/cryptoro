import fs from 'node:fs';

type LegacyImageSize = { width: number; height: number };

const LEGACY_IMAGE_DIMENSIONS: Record<string, LegacyImageSize> = {
  '/images/products/vspomnit-vse-cutout.png': { width: 1800, height: 1124 },
  '/images/products/vspomnit-vse.jpg': { width: 7680, height: 4796 },
  '/images/products/plaud-note-black.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-note-silver.webp': { width: 4000, height: 4000 },
  '/images/products/plaud-note-color-black.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-note-color-blue.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-note-color-gold.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-note-color-silver.webp': { width: 2000, height: 2000 },
  '/images/products/Plaud_Note_Pro-front-black.webp': { width: 4000, height: 4000 },
  '/images/products/Plaud_Note_Pro-front-silver.webp': { width: 4000, height: 4000 },
  '/images/products/plaud-notepin.webp': { width: 3240, height: 3240 },
  '/images/products/plaud-notepin-gray.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-notepin-silver.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-notepin-purple.webp': { width: 2000, height: 2000 },
  '/images/products/plaud-accessories.webp': { width: 2000, height: 2000 },
  '/images/products/note-magnetic-case-black-0225.webp': { width: 2000, height: 2000 },
  '/images/products/note-magnetic-case-blue-0225.webp': { width: 2000, height: 2000 },
  '/images/products/note-magnetic-case-brown-0225.webp': { width: 2000, height: 2000 },
  '/images/products/note-magnetic-case-green-0225.webp': { width: 2000, height: 2000 },
  '/images/products/f1nr2y5y5kueey0bkyhn44866pz20o9l.png': { width: 608, height: 588 },
  '/images/products/plaud-ai-pro-12m.svg': { width: 1200, height: 1200 },
  '/images/products/plaud-ai-unlimited-12m.svg': { width: 1200, height: 1200 }
};

function hasAttr(attrs: string, attrName: string): boolean {
  return new RegExp(`\\b${attrName}\\s*=`, 'i').test(attrs);
}

function readSrc(attrs: string): string {
  const match = attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
  return match?.[2] ?? '';
}

interface OptimizeLegacyImagesOptions {
  eagerFirstMatchSrc?: string[];
}

export function optimizeLegacyImages(html: string, options: OptimizeLegacyImagesOptions = {}) {
  const eagerSrcSet = new Set(options.eagerFirstMatchSrc ?? []);
  const eagerSrcSeen = new Set<string>();

  return html.replace(/<img\b((?:[^>"']+|"[^"]*"|'[^']*')*)>/gi, (tag, attrs) => {
    const src = readSrc(attrs);
    if (!src) return tag;

    const size = LEGACY_IMAGE_DIMENSIONS[src];
    if (!size) return tag;

    const isSelfClosing = /\/\s*$/.test(attrs);
    let nextAttrs = attrs.replace(/\/\s*$/, '');

    if (!hasAttr(nextAttrs, 'width')) nextAttrs += ` width="${size.width}"`;
    if (!hasAttr(nextAttrs, 'height')) nextAttrs += ` height="${size.height}"`;
    if (!hasAttr(nextAttrs, 'decoding')) nextAttrs += ' decoding="async"';

    const isFirstPriorityImage = eagerSrcSet.has(src) && !eagerSrcSeen.has(src);
    if (isFirstPriorityImage) eagerSrcSeen.add(src);

    if (!hasAttr(nextAttrs, 'loading')) {
      nextAttrs += isFirstPriorityImage ? ' loading="eager"' : ' loading="lazy"';
    }

    if (!hasAttr(nextAttrs, 'fetchpriority')) {
      nextAttrs += isFirstPriorityImage ? ' fetchpriority="high"' : ' fetchpriority="low"';
    }

    return `<img${nextAttrs}${isSelfClosing ? ' /' : ''}>`;
  });
}

export function parseLegacyPage(html: string) {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descriptionMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?\s*>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const head = headMatch?.[1] ?? '';

  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1] ?? '')
    .join('\n');
  const headScripts = [...head.matchAll(/<script[\s\S]*?<\/script>/gi)]
    .map((m) => m[0])
    .join('\n');

  return {
    title: titleMatch?.[1]?.trim() ?? 'CRYPTORO',
    description: descriptionMatch?.[1]?.trim() ?? '',
    css,
    headScripts,
    body: bodyMatch?.[1] ?? ''
  };
}

export function loadLegacyPage(filename: string) {
  return parseLegacyPage(fs.readFileSync(filename, 'utf-8'));
}
