type Env = {
  MS_TOKEN?: string;
  MS_WAREHOUSE_ID?: string;
  MS_PRICE_TYPE_ID?: string;
  MS_SKU_MAP_JSON?: string;
  MS_STOCK_ZERO_MODE?: string;
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
const DEFAULT_SKU_MAP: Record<string, string> = {
  vspomnit: 'FR-277',
  'plaud-note': 'FR-143'
};

const parseSkuMap = (raw?: string): Record<string, string> => {
  if (!raw) return DEFAULT_SKU_MAP;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...DEFAULT_SKU_MAP, ...parsed };
  } catch {
    return DEFAULT_SKU_MAP;
  }
};

const parseWarehouseId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/[0-9a-f-]{36}/i);
  return match ? match[0] : value;
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

const buildAssortmentUrl = (sku: string, warehouseId?: string): string => {
  const url = new URL(`${API_BASE}/entity/assortment`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('filter', `article=${sku}`);
  if (warehouseId) {
    url.searchParams.set('stockStore', `${API_BASE}/entity/store/${warehouseId}`);
  }
  return url.toString();
};

const msFetch = async (url: string, token: string) => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`MoySklad API ${response.status}`);
  }
  return response.json();
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
    const skuMap = parseSkuMap(context.env.MS_SKU_MAP_JSON);
    const requested = new URL(context.request.url).searchParams.get('slugs');
    const requestedSlugs = requested
      ? requested
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : Object.keys(skuMap);
    const warehouseId = parseWarehouseId(context.env.MS_WAREHOUSE_ID);
    const priceTypeId = context.env.MS_PRICE_TYPE_ID;
    const stockZeroMode = context.env.MS_STOCK_ZERO_MODE === 'hide' ? 'hide' : 'preorder';

    const resultItems: Record<string, { sku: string; price: number; stock: number; status: 'in_stock' | 'preorder' }> = {};

    await Promise.all(
      requestedSlugs.map(async (slug) => {
        const sku = skuMap[slug];
        if (!sku) return;
        const payload = (await msFetch(buildAssortmentUrl(sku, warehouseId), token)) as { rows?: MsAssortmentRow[] };
        const row = payload.rows?.[0];
        if (!row) return;

        const stock = readStock(row);
        const status: 'in_stock' | 'preorder' = stock > 0 || stockZeroMode === 'hide' ? 'in_stock' : 'preorder';
        resultItems[slug] = {
          sku,
          price: readPrice(row, priceTypeId),
          stock,
          status
        };
      })
    );

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
