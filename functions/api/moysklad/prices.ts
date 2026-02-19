type Env = {
  MS_TOKEN?: string;
  MS_WAREHOUSE_ID?: string;
  MS_PRICE_TYPE_ID?: string;
  MS_SKU_MAP_JSON?: string;
  MS_STOCK_ZERO_MODE?: string;
  MS_PRICE_RULE?: string;
  MS_STOCK_RULE?: string;
};

type MsAssortmentRow = {
  article?: string;
  code?: string;
  stock?: number;
  quantity?: number;
  salePrices?: Array<{
    value?: number;
    priceType?: { id?: string };
  }>;
};

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2';
const DEFAULT_SKU_MAP: Record<string, string[]> = {
  vspomnit: ['CR-228'],
  'plaud-note': ['CR-191', 'CR-400', 'CR-197', 'CR-209'],
  'plaud-note-pro': ['CR-327'],
  notepin: ['CR-217', 'CR-256', 'CR-258'],
  accessories: ['AC-40']
};

const normalizeSkuList = (value: unknown): string[] => {
  if (value && typeof value === 'object') {
    const candidate = value as { skus?: unknown; sku?: unknown };
    if (candidate.skus) return normalizeSkuList(candidate.skus);
    if (candidate.sku) return normalizeSkuList(candidate.sku);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
};

const parseSkuMap = (raw?: string): Record<string, string[]> => {
  if (!raw) return DEFAULT_SKU_MAP;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = Object.entries(parsed).reduce<Record<string, string[]>>((acc, [slug, value]) => {
      const skus = normalizeSkuList(value);
      if (skus.length) acc[slug] = skus;
      return acc;
    }, {});
    return { ...DEFAULT_SKU_MAP, ...normalized };
  } catch {
    return DEFAULT_SKU_MAP;
  }
};

const parseSkuPairs = (raw?: string | null): Record<string, string[]> => {
  if (!raw) return {};
  return raw.split(',').reduce<Record<string, string[]>>((acc, pair) => {
    const [slugRaw, skuRaw] = pair.split(':');
    const slug = (slugRaw || '').trim();
    const skuCandidates = (skuRaw || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
    if (slug && skuCandidates.length) {
      acc[slug] = Array.from(new Set([...(acc[slug] || []), ...skuCandidates]));
    }
    return acc;
  }, {});
};

const mergeSkuMaps = (
  envMap: Record<string, string[]>,
  requestMap: Record<string, string[]>
): Record<string, string[]> => {
  const merged: Record<string, string[]> = { ...envMap };
  // skuMap из запроса может целенаправленно переопределять slug (например выбранный цвет в карточке товара).
  Object.entries(requestMap).forEach(([slug, skus]) => {
    if (skus.length) merged[slug] = skus;
  });
  return merged;
};

const parseWarehouseId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/[0-9a-f-]{36}/i);
  // Если UUID не распознан, не передаем stockStore вовсе, чтобы не ломать запрос в МойСклад.
  return match ? match[0] : undefined;
};

const toRub = (value?: number): number => {
  if (!value || Number.isNaN(value)) return 0;
  return Math.round(value / 100);
};

const readPrice = (row: MsAssortmentRow, priceTypeId?: string): number => {
  const prices = row.salePrices ?? [];
  if (!prices.length) return 0;
  if (priceTypeId) {
    const matched = prices.find((item) => item?.priceType?.id === priceTypeId);
    if (matched?.value) return toRub(matched.value);
  }
  const first = prices.find((item) => typeof item?.value === 'number');
  return toRub(first?.value);
};

const readStock = (row: MsAssortmentRow): number => {
  const stock = Number(row.stock ?? row.quantity ?? 0);
  return Number.isFinite(stock) ? stock : 0;
};

const aggregatePrice = (values: number[], rule: 'min' | 'max' | 'first'): number => {
  const prices = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!prices.length) return 0;
  if (rule === 'max') return Math.max(...prices);
  if (rule === 'first') return prices[0];
  return Math.min(...prices);
};

const aggregateStock = (values: number[], rule: 'sum' | 'max' | 'first'): number => {
  const stocks = values.map((value) => (Number.isFinite(value) ? value : 0));
  if (!stocks.length) return 0;
  if (rule === 'max') return Math.max(...stocks);
  if (rule === 'first') return stocks[0];
  return stocks.reduce((acc, value) => acc + value, 0);
};

const buildAssortmentUrl = (sku: string, warehouseId?: string, mode: 'article' | 'code' | 'search' = 'article'): string => {
  const url = new URL(`${API_BASE}/entity/assortment`);
  url.searchParams.set('limit', mode === 'search' ? '25' : '1');
  if (mode === 'search') {
    url.searchParams.set('search', sku);
  } else {
    url.searchParams.set('filter', `${mode}=${sku}`);
  }
  if (warehouseId) {
    url.searchParams.set('stockStore', `${API_BASE}/entity/store/${warehouseId}`);
  }
  return url.toString();
};

const equalsSku = (value: string | undefined, sku: string): boolean => {
  return String(value || '').trim().toUpperCase() === String(sku || '').trim().toUpperCase();
};

const msFetch = async (url: string, token: string) => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json;charset=utf-8'
        }
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxRetries) {
          const backoffMs = 250 * Math.pow(2, attempt) + Math.floor(Math.random() * 120);
          await wait(backoffMs);
          continue;
        }
        throw new Error(`MoySklad API ${response.status}${body ? `: ${body.slice(0, 280)}` : ''}`);
      }
      return response.json();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      const backoffMs = 250 * Math.pow(2, attempt) + Math.floor(Math.random() * 120);
      await wait(backoffMs);
    }
  }

  throw new Error('MoySklad fetch failed');
};

const findRowBySku = async (sku: string, token: string, warehouseId?: string): Promise<MsAssortmentRow | undefined> => {
  const directByArticle = (await msFetch(buildAssortmentUrl(sku, warehouseId, 'article'), token)) as { rows?: MsAssortmentRow[] };
  if (directByArticle.rows?.length) {
    const exactArticle = directByArticle.rows.find((row) => equalsSku(row.article, sku) || equalsSku(row.code, sku));
    if (exactArticle) return exactArticle;
  }

  const directByCode = (await msFetch(buildAssortmentUrl(sku, warehouseId, 'code'), token)) as { rows?: MsAssortmentRow[] };
  if (directByCode.rows?.length) {
    const exactCode = directByCode.rows.find((row) => equalsSku(row.code, sku) || equalsSku(row.article, sku));
    if (exactCode) return exactCode;
  }

  const bySearch = (await msFetch(buildAssortmentUrl(sku, warehouseId, 'search'), token)) as { rows?: MsAssortmentRow[] };
  if (!bySearch.rows?.length) return undefined;

  // Без «наугад» фолбэка: берем только точное совпадение SKU.
  return bySearch.rows.find((row) => equalsSku(row.article, sku) || equalsSku(row.code, sku));
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const token = context.env.MS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'MS_TOKEN is not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    const url = new URL(context.request.url);
    const envSkuMap = parseSkuMap(context.env.MS_SKU_MAP_JSON);
    const requestSkuMap = parseSkuPairs(url.searchParams.get('skuMap'));
    const skuMap = mergeSkuMaps(envSkuMap, requestSkuMap);
    const requested = url.searchParams.get('slugs');
    const requestedSlugs = requested
      ? requested
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : Object.keys(skuMap);
    const warehouseId = parseWarehouseId(context.env.MS_WAREHOUSE_ID);
    const priceTypeId = context.env.MS_PRICE_TYPE_ID;
    const stockZeroMode = context.env.MS_STOCK_ZERO_MODE === 'hide' ? 'hide' : 'preorder';
    const priceRule = context.env.MS_PRICE_RULE === 'max' ? 'max' : context.env.MS_PRICE_RULE === 'first' ? 'first' : 'min';
    const stockRule = context.env.MS_STOCK_RULE === 'max' ? 'max' : context.env.MS_STOCK_RULE === 'first' ? 'first' : 'sum';

    type StockStatus = 'in_stock' | 'low_stock' | 'preorder' | 'hidden';
    const resultItems: Record<string, { sku: string; skus: string[]; price: number; stock: number; status: StockStatus }> = {};

    for (const slug of requestedSlugs) {
      const skus = skuMap[slug] || [];
      if (!skus.length) continue;

      const rows: MsAssortmentRow[] = [];
      for (const sku of skus) {
        const row = await findRowBySku(sku, token, warehouseId);
        if (row) rows.push(row);
      }
      if (!rows.length) continue;

      const stock = aggregateStock(
        rows.map((row) => readStock(row)),
        stockRule
      );
      const price = aggregatePrice(
        rows.map((row) => readPrice(row, priceTypeId)),
        priceRule
      );
      let status: StockStatus = 'in_stock';
      if (stock <= 0) {
        status = stockZeroMode === 'hide' ? 'hidden' : 'preorder';
      } else if (stock <= 5) {
        status = 'low_stock';
      }
      resultItems[slug] = {
        sku: skus[0],
        skus,
        price,
        stock,
        status
      };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: new Date().toISOString(),
        items: resultItems
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=60, s-maxage=300'
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown MoySklad error'
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    );
  }
};
