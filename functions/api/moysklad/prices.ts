type Env = {
  MS_TOKEN?: string;
  MS_WAREHOUSE_ID?: string;
  MS_PRICE_TYPE_ID?: string;
  MS_SKU_MAP_JSON?: string;
  MS_SKU_META_JSON?: string;
  MS_GROUP_ID_OR_NAME?: string;
  MS_GROUP_ID?: string;
  MS_GROUP_NAME?: string;
  MS_STOCK_ZERO_MODE?: string;
  MS_PRICE_RULE?: string;
  MS_STOCK_RULE?: string;
};

type MsAssortmentRow = {
  article?: string;
  code?: string;
  name?: string;
  pathName?: string;
  productFolder?: {
    meta?: { href?: string };
    name?: string;
  };
  stock?: number;
  quantity?: number;
  reserve?: number;
  salePrices?: Array<{
    value?: number;
    priceType?: { id?: string };
  }>;
};

type MsStockReportRow = {
  stock?: number;
  quantity?: number;
  reserve?: number;
  article?: string;
  code?: string;
  assortment?: {
    article?: string;
    code?: string;
    name?: string;
    meta?: { href?: string };
  };
};

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2';
const DEFAULT_SKU_MAP: Record<string, string[]> = {
  vspomnit: ['CR-228'],
  'plaud-note': ['CR-191', 'CR-400', 'CR-197', 'CR-209'],
  'plaud-note-pro': ['CR-327'],
  notepin: ['CR-217', 'CR-256', 'CR-258'],
  accessories: ['AC-40']
};

// Дефолтная группа для витрины CRYPTORO (используется, если переменная MS_GROUP_* не задана в Cloudflare).
const DEFAULT_GROUP_NAME = 'Товары для самовыкупов';

const DEFAULT_SKU_META: Record<string, { color?: string; title?: string }> = {
  'CR-228': { color: 'Graphite', title: 'Вспомни всё' },
  'CR-191': { color: 'Black', title: 'Plaud Note' },
  'CR-400': { color: 'Navy Blue', title: 'Plaud Note' },
  'CR-197': { color: 'Silver', title: 'Plaud Note' },
  'CR-209': { color: 'Starlight', title: 'Plaud Note' },
  'CR-327': { color: 'Black', title: 'Plaud Note Pro' },
  'CR-217': { color: 'Cosmic Gray', title: 'Plaud NotePin' },
  'CR-256': { color: 'Lunar Silver', title: 'Plaud NotePin' },
  'CR-258': { color: 'Sunset Purple', title: 'Plaud NotePin' },
  'AC-40': { title: 'Набор аксессуаров' }
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

const parseSkuMetaMap = (raw?: string): Record<string, { color?: string; title?: string }> => {
  if (!raw) return DEFAULT_SKU_META;
  try {
    const parsed = JSON.parse(raw) as Record<string, { color?: unknown; title?: unknown }>;
    const normalized = Object.entries(parsed).reduce<Record<string, { color?: string; title?: string }>>((acc, [sku, meta]) => {
      if (!sku) return acc;
      const color = String(meta?.color || '').trim();
      const title = String(meta?.title || '').trim();
      acc[sku] = {
        ...(color ? { color } : {}),
        ...(title ? { title } : {})
      };
      return acc;
    }, {});
    return { ...DEFAULT_SKU_META, ...normalized };
  } catch {
    return DEFAULT_SKU_META;
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

const parseGroupMatcher = (env: Env): { id?: string; name?: string } => {
  const raw = String(
    env.MS_GROUP_ID_OR_NAME || env.MS_GROUP_ID || env.MS_GROUP_NAME || DEFAULT_GROUP_NAME
  ).trim();
  if (!raw) return {};
  const id = raw.match(/[0-9a-f-]{36}/i)?.[0];
  if (id) return { id };
  return { name: raw.toLowerCase() };
};

const rowMatchesGroup = (row: MsAssortmentRow, matcher: { id?: string; name?: string }): boolean => {
  if (!matcher.id && !matcher.name) return true;

  if (matcher.id) {
    const href = String(row.productFolder?.meta?.href || '').toLowerCase();
    return href.includes(matcher.id.toLowerCase());
  }

  const target = matcher.name || '';
  const path = String(row.pathName || '').toLowerCase();
  const folderName = String(row.productFolder?.name || '').toLowerCase();
  return path.includes(target) || folderName.includes(target);
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
  // Для сайта используем "Доступно" из МойСклад (поле stock) в приоритете.
  // Если stock отсутствует, откатываемся к quantity - reserve.
  const stock = Number(row.stock);
  if (Number.isFinite(stock)) {
    return Math.max(0, Math.round(stock));
  }

  const quantity = Number(row.quantity);
  const reserve = Number(row.reserve ?? 0);
  if (Number.isFinite(quantity)) {
    const available = Math.max(0, quantity - (Number.isFinite(reserve) ? reserve : 0));
    return Math.round(available);
  }
  return 0;
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

const toWarehouseHref = (warehouseId?: string): string | undefined => {
  if (!warehouseId) return undefined;
  return `${API_BASE}/entity/store/${warehouseId}`;
};

const buildAssortmentPageUrl = (offset: number, warehouseId?: string): string => {
  const url = new URL(`${API_BASE}/entity/assortment`);
  url.searchParams.set('limit', '1000');
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('expand', 'salePrices');
  const warehouseHref = toWarehouseHref(warehouseId);
  if (warehouseHref) {
    // В remap API stockStore должен быть ссылкой на склад, а не просто UUID.
    url.searchParams.set('stockStore', warehouseHref);
  }
  return url.toString();
};

const buildAssortmentLookupUrl = (sku: string, warehouseId?: string, mode: 'article' | 'code' = 'article'): string => {
  const url = new URL(`${API_BASE}/entity/assortment`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('expand', 'salePrices');
  url.searchParams.set('filter', `${mode}=${sku}`);
  const warehouseHref = toWarehouseHref(warehouseId);
  if (warehouseHref) {
    url.searchParams.set('stockStore', warehouseHref);
  }
  return url.toString();
};

const buildStockReportPageUrl = (offset: number, warehouseHref: string): string => {
  const url = new URL(`${API_BASE}/report/stock/all`);
  url.searchParams.set('limit', '1000');
  url.searchParams.set('offset', String(offset));
  // Критично: фильтр по конкретному складу, чтобы не суммировать остатки со всех складов.
  url.searchParams.set('filter', `store=${warehouseHref}`);
  return url.toString();
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

const readStockFromReport = (row: MsStockReportRow): number => {
  const stock = Number(row.stock);
  if (Number.isFinite(stock)) {
    return Math.max(0, Math.round(stock));
  }
  const quantity = Number(row.quantity);
  const reserve = Number(row.reserve ?? 0);
  if (Number.isFinite(quantity)) {
    return Math.max(0, Math.round(quantity - (Number.isFinite(reserve) ? reserve : 0)));
  }
  return 0;
};

const fetchStockBySku = async (
  token: string,
  warehouseId?: string
): Promise<{ bySku: Map<string, number>; rowsCount: number; source: string }> => {
  const warehouseHref = toWarehouseHref(warehouseId);
  if (!warehouseHref) {
    return { bySku: new Map(), rowsCount: 0, source: 'assortment_fallback_no_warehouse' };
  }

  const bySku = new Map<string, number>();
  let offset = 0;
  let rowsCount = 0;

  while (true) {
    const page = (await msFetch(buildStockReportPageUrl(offset, warehouseHref), token)) as {
      rows?: MsStockReportRow[];
    };
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    rowsCount += rows.length;

    rows.forEach((row) => {
      const stock = readStockFromReport(row);
      const candidates = [
        String(row.article || '').trim().toUpperCase(),
        String(row.code || '').trim().toUpperCase(),
        String(row.assortment?.article || '').trim().toUpperCase(),
        String(row.assortment?.code || '').trim().toUpperCase()
      ].filter(Boolean);

      candidates.forEach((key) => {
        bySku.set(key, stock);
      });
    });

    if (!rows.length || rows.length < 1000) break;
    offset += rows.length;
    if (offset > 100000) break;
  }

  return { bySku, rowsCount, source: 'report_stock_all_store_filter' };
};

const fetchAssortmentRows = async (
  token: string,
  warehouseId?: string,
  groupMatcher?: { id?: string; name?: string },
  expectedSkus?: string[]
): Promise<{ rows: MsAssortmentRow[]; groupFilterApplied: boolean }> => {
  const allRows: MsAssortmentRow[] = [];
  const filteredRows: MsAssortmentRow[] = [];
  let offset = 0;

  while (true) {
    const page = (await msFetch(buildAssortmentPageUrl(offset, warehouseId), token)) as {
      rows?: MsAssortmentRow[];
      meta?: { size?: number };
    };
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    allRows.push(...rows);
    if (groupMatcher?.id || groupMatcher?.name) {
      filteredRows.push(...rows.filter((row) => rowMatchesGroup(row, groupMatcher)));
    }

    if (!rows.length || rows.length < 1000) break;
    offset += rows.length;
    if (offset > 10000) break;
  }

  if (groupMatcher?.id || groupMatcher?.name) {
    if (filteredRows.length > 0) {
      // Если фильтр группы вернул строки, но среди них нет нужных SKU для витрины,
      // откатываемся на полный список, чтобы не отдавать пустой items.
      const expectedSet = new Set((expectedSkus || []).map((sku) => String(sku || '').trim().toUpperCase()).filter(Boolean));
      if (expectedSet.size > 0) {
        const hasAnyExpectedSku = filteredRows.some((row) => {
          const article = String(row.article || '').trim().toUpperCase();
          const code = String(row.code || '').trim().toUpperCase();
          return expectedSet.has(article) || expectedSet.has(code);
        });
        if (!hasAnyExpectedSku) {
          return { rows: allRows, groupFilterApplied: false };
        }
      }
      return { rows: filteredRows, groupFilterApplied: true };
    }
    // Fallback: если фильтр группы не сработал/не совпал, не ломаем синхронизацию цен и остатков.
    return { rows: allRows, groupFilterApplied: false };
  }

  return { rows: allRows, groupFilterApplied: false };
};

const findRowBySkuFallback = async (
  sku: string,
  token: string,
  warehouseId?: string,
  groupMatcher?: { id?: string; name?: string }
): Promise<MsAssortmentRow | undefined> => {
  const normalized = String(sku || '').trim();
  if (!normalized) return undefined;

  const byArticle = (await msFetch(buildAssortmentLookupUrl(normalized, warehouseId, 'article'), token)) as {
    rows?: MsAssortmentRow[];
  };
  if (Array.isArray(byArticle?.rows) && byArticle.rows.length) {
    const matched = byArticle.rows.find((row) => rowMatchesGroup(row, groupMatcher || {}));
    if (matched) return matched;
  }

  const byCode = (await msFetch(buildAssortmentLookupUrl(normalized, warehouseId, 'code'), token)) as {
    rows?: MsAssortmentRow[];
  };
  if (Array.isArray(byCode?.rows) && byCode.rows.length) {
    const matched = byCode.rows.find((row) => rowMatchesGroup(row, groupMatcher || {}));
    if (matched) return matched;
  }

  return undefined;
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
    const groupMatcher = parseGroupMatcher(context.env);
    const priceTypeId = context.env.MS_PRICE_TYPE_ID;
    const skuMetaMap = parseSkuMetaMap(context.env.MS_SKU_META_JSON);
    const stockZeroMode = context.env.MS_STOCK_ZERO_MODE === 'hide' ? 'hide' : 'preorder';
    const priceRule = context.env.MS_PRICE_RULE === 'max' ? 'max' : context.env.MS_PRICE_RULE === 'first' ? 'first' : 'min';
    const stockRule = context.env.MS_STOCK_RULE === 'max' ? 'max' : context.env.MS_STOCK_RULE === 'first' ? 'first' : 'sum';

    type StockStatus = 'in_stock' | 'low_stock' | 'preorder' | 'hidden';
    const resultItems: Record<
      string,
      {
        sku: string;
        skus: string[];
        price: number;
        stock: number;
        status: StockStatus;
        variants: Array<{ sku: string; stock: number; price: number; status: StockStatus; color?: string; title?: string }>;
      }
    > = {};

    const expectedSkus = requestedSlugs.flatMap((slug) => skuMap[slug] || []);
    const { rows: allRows, groupFilterApplied } = await fetchAssortmentRows(
      token,
      warehouseId,
      groupMatcher,
      expectedSkus
    );
    const stockData = await fetchStockBySku(token, warehouseId);
    const rowBySku = new Map<string, MsAssortmentRow>();
    allRows.forEach((row) => {
      const article = String(row.article || '').trim();
      const code = String(row.code || '').trim();
      if (article && !rowBySku.has(article.toUpperCase())) rowBySku.set(article.toUpperCase(), row);
      if (code && !rowBySku.has(code.toUpperCase())) rowBySku.set(code.toUpperCase(), row);
    });

    for (const slug of requestedSlugs) {
      const skus = skuMap[slug] || [];
      if (!skus.length) continue;

      const variants: Array<{
        sku: string;
        stock: number;
        price: number;
        status: StockStatus;
        color?: string;
        title?: string;
      }> = [];

      for (const sku of skus) {
        const normalizedSku = String(sku || '').trim().toUpperCase();
        let row = rowBySku.get(normalizedSku);
        if (!row) {
          row = await findRowBySkuFallback(sku, token, warehouseId, groupMatcher);
          // Fallback: если по фильтру группы SKU не найден, пробуем глобальный поиск.
          if (!row && (groupMatcher.id || groupMatcher.name)) {
            row = await findRowBySkuFallback(sku, token, warehouseId);
          }
          if (row) {
            const article = String(row.article || '').trim();
            const code = String(row.code || '').trim();
            if (article) rowBySku.set(article.toUpperCase(), row);
            if (code) rowBySku.set(code.toUpperCase(), row);
          }
        }

        // Критично: остатки считаем ТОЛЬКО из отчета по конкретному складу.
        // Если SKU отсутствует в report/stock/all (store=...), считаем 0 и ставим preorder/hidden.
        const stock = stockData.bySku.get(normalizedSku) ?? 0;
        const price = row ? readPrice(row, priceTypeId) : 0;
        let status: StockStatus = 'in_stock';
        if (stock <= 0) {
          status = stockZeroMode === 'hide' ? 'hidden' : 'preorder';
        } else if (stock <= 5) {
          status = 'low_stock';
        }

        variants.push({
          sku,
          stock,
          price,
          status,
          color: skuMetaMap[sku]?.color,
          title: skuMetaMap[sku]?.title
        });
      }

      const stock = aggregateStock(
        variants.map((variant) => variant.stock),
        stockRule
      );
      const price = aggregatePrice(
        variants.map((variant) => variant.price),
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
        status,
        variants
      };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: new Date().toISOString(),
        warehouseId: warehouseId ?? null,
        warehouseParam: toWarehouseHref(warehouseId) ?? null,
        groupFilter: groupMatcher.id || groupMatcher.name || null,
        groupFilterApplied,
        stockSource: stockData.source,
        stockRowsFetched: stockData.rowsCount,
        rowsFetched: allRows.length,
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
