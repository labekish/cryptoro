#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PRICING_RECALC_CONFIG } from './recalc.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const productsDir = path.join(repoRoot, 'src', 'content', 'products');
const reportPath = path.join(repoRoot, 'tmp', 'pricing-report.json');
const DEFAULT_TIMEOUT_MS = 15000;

function printUsage() {
  console.log(
    [
      'Usage:',
      '  npm run pricing:recalc -- --api-base=https://<site-domain> [--apply] [--timeout=15000]',
      '',
      'Options:',
      '  --api-base   Base URL of deployed site (required), example: https://cryptoro-site.pages.dev',
      '  --apply      Apply calculated prices to src/content/products/*.mdx',
      '  --timeout    HTTP timeout in ms for API requests',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const parsed = {
    apiBase: '',
    apply: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }

    if (arg.startsWith('--api-base=')) {
      parsed.apiBase = arg.slice('--api-base='.length).trim();
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      const timeout = Number(arg.slice('--timeout='.length));
      if (Number.isFinite(timeout) && timeout > 0) {
        parsed.timeoutMs = Math.floor(timeout);
      }
    }
  }

  return parsed;
}

function normalizeApiBase(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Missing --api-base');
  const parsed = new URL(raw);
  return parsed.toString().replace(/\/$/, '');
}

function unique(items) {
  return Array.from(new Set(items));
}

function roundUpToStep(value, step) {
  const safeValue = Math.max(0, Number(value) || 0);
  const safeStep = Math.max(1, Math.floor(Number(step) || 1));
  return Math.ceil(safeValue / safeStep) * safeStep;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('Frontmatter block not found');
  return {
    full: match[0],
    body: match[1],
  };
}

function readFrontmatterValue(frontmatterBody, key) {
  const match = frontmatterBody.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return '';
  return String(match[1] || '').trim().replace(/^['\"]|['\"]$/g, '').trim();
}

function replaceFrontmatterPrice(content, nextPrice) {
  const fm = parseFrontmatter(content);
  const priceLine = /^price:\s*.+$/m;
  const nextFm = priceLine.test(fm.full)
    ? fm.full.replace(priceLine, `price: ${nextPrice}`)
    : fm.full.replace(/\n---$/, `\nprice: ${nextPrice}\n---`);
  return content.replace(fm.full, nextFm);
}

function mapGroupBySlug(groups) {
  const map = new Map();
  for (const [groupKey, groupConfig] of Object.entries(groups)) {
    const slugs = Array.isArray(groupConfig?.slugs) ? groupConfig.slugs : [];
    for (const slug of slugs) {
      if (map.has(slug)) {
        throw new Error(`Slug ${slug} belongs to multiple groups`);
      }
      map.set(slug, groupKey);
    }
  }
  return map;
}

async function readContentProducts() {
  const dirEntries = await fs.readdir(productsDir, { withFileTypes: true });
  const files = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => path.join(productsDir, entry.name))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const products = new Map();

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const fm = parseFrontmatter(content);
    const slug = readFrontmatterValue(fm.body, 'slug');
    const priceRaw = readFrontmatterValue(fm.body, 'price');
    const contentPrice = Number(priceRaw);

    if (!slug) {
      throw new Error(`Missing slug in ${filePath}`);
    }
    if (!Number.isFinite(contentPrice) || contentPrice <= 0) {
      throw new Error(`Invalid price in ${filePath}`);
    }

    products.set(slug, {
      slug,
      filePath,
      content,
      contentPrice: Math.round(contentPrice),
    });
  }

  return products;
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 400)}`);
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchMoyskladSnapshot(apiBase, slugs, timeoutMs) {
  const url = new URL('/api/moysklad/prices', apiBase);
  url.searchParams.set('slugs', unique(slugs).join(','));

  const payload = await fetchJson(url.toString(), { method: 'GET' }, timeoutMs);
  if (!payload?.ok || !payload?.items || typeof payload.items !== 'object') {
    throw new Error('Invalid /api/moysklad/prices payload');
  }

  const out = new Map();
  for (const slug of slugs) {
    const row = payload.items[slug];
    const price = Number(row?.price);
    if (Number.isFinite(price) && price > 0) {
      out.set(slug, Math.round(price));
    }
  }

  return out;
}

async function fetchCdekGroupCityFinalPrice(apiBase, cityConfig, groupConfig, timeoutMs) {
  const url = new URL('/api/cdek/calculate', apiBase);
  const item = groupConfig?.pickupRequest?.item;
  if (!item) {
    throw new Error(`Group ${groupConfig.label || 'unknown'} has no pickupRequest.item profile`);
  }

  const payload = {
    city: cityConfig.city,
    street: cityConfig.street,
    zip: cityConfig.zip,
    deliveryType: 'pickup',
    items: [
      {
        weight: Math.max(1, Number(item.weight) || 1),
        length: Math.max(1, Number(item.length) || 1),
        width: Math.max(1, Number(item.width) || 1),
        height: Math.max(1, Number(item.height) || 1),
        qty: Math.max(1, Number(item.qty) || 1),
        price: Math.max(0, Number(item.price) || 0),
      },
    ],
  };

  const data = await fetchJson(
    url.toString(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  if (!data?.ok) {
    throw new Error(`CDEK response is not ok for ${cityConfig.city}`);
  }
  if (String(data?.mode || '') !== 'live') {
    throw new Error(`CDEK mode is not live for ${cityConfig.city}: ${String(data?.mode || 'unknown')}`);
  }

  const finalPrice = Number(data?.finalPrice ?? data?.quote?.priceRub);
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
    throw new Error(`Invalid CDEK final price for ${cityConfig.city}`);
  }

  return {
    finalPrice: Math.ceil(finalPrice),
    tariffCode: Number(data?.tariffCode || data?.quote?.tariffCode || 0) || 0,
  };
}

function validateCityShares(cities) {
  const totalShare = cities.reduce((sum, city) => sum + Number(city.share || 0), 0);
  if (Math.abs(totalShare - 1) > 0.000001) {
    throw new Error(`City shares must sum to 1.0, got ${totalShare}`);
  }
}

async function calculateGroupSurcharges(apiBase, config, timeoutMs) {
  validateCityShares(config.cities);

  const entries = Object.entries(config.groups);
  const out = {};

  for (const [groupKey, groupConfig] of entries) {
    if (Number.isFinite(groupConfig.fixedSurchargeRub)) {
      out[groupKey] = {
        groupLabel: groupConfig.label || groupKey,
        surchargeRub: Math.ceil(Number(groupConfig.fixedSurchargeRub)),
        weightedRaw: Number(groupConfig.fixedSurchargeRub),
        cityResults: [],
      };
      continue;
    }

    const cityResults = [];
    for (const cityConfig of config.cities) {
      const delivery = await fetchCdekGroupCityFinalPrice(apiBase, cityConfig, groupConfig, timeoutMs);
      cityResults.push({
        city: cityConfig.city,
        share: Number(cityConfig.share),
        finalPrice: delivery.finalPrice,
        weightedContribution: Number((delivery.finalPrice * Number(cityConfig.share)).toFixed(4)),
        tariffCode: delivery.tariffCode,
      });
    }

    const weightedRaw = cityResults.reduce((sum, row) => sum + row.weightedContribution, 0);
    out[groupKey] = {
      groupLabel: groupConfig.label || groupKey,
      surchargeRub: Math.ceil(weightedRaw),
      weightedRaw: Number(weightedRaw.toFixed(4)),
      cityResults,
    };
  }

  return out;
}

function buildProductPlan({ contentProducts, groupBySlug, msSnapshot, groupSurcharges, priceRoundingStepRub }) {
  const planned = [];

  for (const [slug, product] of contentProducts.entries()) {
    const groupKey = groupBySlug.get(slug);
    if (!groupKey) {
      throw new Error(`No group mapping for content slug: ${slug}`);
    }

    const groupCalc = groupSurcharges[groupKey];
    if (!groupCalc) {
      throw new Error(`No surcharge result for group: ${groupKey}`);
    }

    const basePriceFromMs = Number(msSnapshot.get(slug));
    if (!Number.isFinite(basePriceFromMs) || basePriceFromMs <= 0) {
      throw new Error(`Missing MoySklad snapshot price for slug: ${slug}`);
    }

    const surcharge = Math.max(0, Number(groupCalc.surchargeRub) || 0);
    const rawFinalPrice = basePriceFromMs + surcharge;
    const finalPrice = roundUpToStep(rawFinalPrice, priceRoundingStepRub);

    planned.push({
      slug,
      filePath: product.filePath,
      contentPrice: product.contentPrice,
      basePriceFromMs,
      groupKey,
      groupLabel: groupCalc.groupLabel,
      surchargeRub: surcharge,
      rawFinalPrice,
      roundingStepRub: Math.max(1, Math.floor(Number(priceRoundingStepRub) || 1)),
      finalPrice,
      changed: finalPrice !== product.contentPrice,
    });
  }

  planned.sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
  return planned;
}

async function applyProductPrices(contentProducts, planned) {
  for (const item of planned) {
    const product = contentProducts.get(item.slug);
    if (!product) continue;
    const updated = replaceFrontmatterPrice(product.content, item.finalPrice);
    await fs.writeFile(item.filePath, updated, 'utf8');
  }
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apiBase) {
    printUsage();
    process.exit(1);
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const groupBySlug = mapGroupBySlug(PRICING_RECALC_CONFIG.groups);
  const priceRoundingStepRub = Math.max(1, Math.floor(Number(PRICING_RECALC_CONFIG.priceRoundingStepRub) || 1));
  const contentProducts = await readContentProducts();
  const contentSlugs = Array.from(contentProducts.keys());
  const configuredSlugs = Array.from(groupBySlug.keys());
  const allSlugsForSnapshot = unique([...contentSlugs, ...configuredSlugs]);

  const msSnapshot = await fetchMoyskladSnapshot(apiBase, allSlugsForSnapshot, args.timeoutMs);
  const groupSurcharges = await calculateGroupSurcharges(apiBase, PRICING_RECALC_CONFIG, args.timeoutMs);

  const planned = buildProductPlan({
    contentProducts,
    groupBySlug,
    msSnapshot,
    groupSurcharges,
    priceRoundingStepRub,
  });

  if (args.apply) {
    await applyProductPrices(contentProducts, planned);
  }

  const changedCount = planned.filter((item) => item.changed).length;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    apiBase,
    assumptions: {
      deliveryType: 'pickup',
      pricesSource: 'moysklad_snapshot',
      subscriptionsSurchargeRub: 0,
      priceRoundingStepRub,
    },
    cities: PRICING_RECALC_CONFIG.cities,
    groupSurcharges,
    products: planned,
    stats: {
      totalProducts: planned.length,
      changedProducts: changedCount,
    },
  };

  await writeReport(report);

  console.log(`Report written: ${reportPath}`);
  console.log(`Products processed: ${planned.length}`);
  console.log(`Products changed: ${changedCount}`);
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
}

main().catch((error) => {
  console.error('pricing:recalc failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
