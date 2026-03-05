type Env = {
  CDEK_CLIENT_ID?: string;
  CDEK_CLIENT_SECRET?: string;
  CDEK_ACCOUNT?: string;
  CDEK_SECURE?: string;
  CDEK_API_BASE?: string;
  CDEK_SENDER_CITY_CODE?: string;
  CDEK_TIMEOUT_MS?: string;
  CDEK_MOCK?: string;
  CDEK_TEST_MODE?: string;
  CDEK_PICKUP_TARIFF_CODES?: string;
  CDEK_DOOR_TARIFF_CODES?: string;
  CDEK_PACKAGE_LENGTH_MM?: string;
  CDEK_PACKAGE_WIDTH_MM?: string;
  CDEK_PACKAGE_HEIGHT_MM?: string;
  CDEK_ITEM_WEIGHT_G?: string;
  CDEK_MARKUP_MULTIPLIER?: string;
  CDEK_COD_RATE?: string;
};

type LegacyCartItem = {
  sku?: string;
  name?: string;
  qty?: number;
  price?: number;
  weightG?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
};

type CalculatePayload = {
  city?: string;
  pvzId?: string | null;
  items?: LegacyCartItem[];
  cod?: boolean;
  itemsTotal?: number;

  // Русский комментарий: поддержка текущего payload, чтобы не ломать прод-фронт.
  zip?: string;
  street?: string;
  apartment?: string;
  orderTotal?: number;
  deliveryType?: 'pickup' | 'door';
};

type DeliveryType = 'pickup' | 'door';

type CdekQuote = {
  provider: 'cdek';
  title: string;
  priceRub: number;
  etaDays: string;
  tariffCode?: number;
};

type CdekAuthSuccess = { ok: true; token: string };
type CdekAuthError = { ok: false; error: string };
type CdekAuthResult = CdekAuthSuccess | CdekAuthError;
type CdekCityResolveResult = { ok: true; code?: number } | { ok: false };

type AggregatedPackage = {
  weightG: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  itemsTotal: number;
};

type TariffCandidate = {
  tariffCode: number;
  tariffName: string;
  totalSum: number;
  periodMin: number;
  periodMax: number;
  deliveryMode: number;
};

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TEST_API_BASE = 'https://api.edu.cdek.ru';
const DEFAULT_PROD_API_BASE = 'https://api.cdek.ru';
const DEFAULT_SENDER_CITY_CODE = 44; // Москва
const DEFAULT_PACKAGE_LENGTH_MM = 86;
const DEFAULT_PACKAGE_WIDTH_MM = 54;
const DEFAULT_PACKAGE_HEIGHT_MM = 3;
const DEFAULT_ITEM_WEIGHT_G = 80;
const DEFAULT_MARKUP_MULTIPLIER = 1.3;
const DEFAULT_COD_RATE = 0.04;

function toTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toPositiveInt(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function toNonNegativeNumber(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function mmToCm(mm: number): number {
  return Math.max(1, Math.ceil(mm / 10));
}

function isMockMode(env: Env): boolean {
  return String(env.CDEK_MOCK || '').trim() === '1';
}

function isTestMode(env: Env): boolean {
  return String(env.CDEK_TEST_MODE || '').trim() === '1';
}

function getCdekCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = String(env.CDEK_CLIENT_ID || env.CDEK_ACCOUNT || '').trim();
  const clientSecret = String(env.CDEK_CLIENT_SECRET || env.CDEK_SECURE || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getApiBase(env: Env): string {
  const raw = String(env.CDEK_API_BASE || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return isTestMode(env) ? DEFAULT_TEST_API_BASE : DEFAULT_PROD_API_BASE;
}

function getSenderCityCode(env: Env): number {
  return toPositiveInt(env.CDEK_SENDER_CITY_CODE, DEFAULT_SENDER_CITY_CODE);
}

function getTimeoutMs(env: Env): number {
  return toPositiveInt(env.CDEK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function getMarkupMultiplier(env: Env): number {
  return toNonNegativeNumber(env.CDEK_MARKUP_MULTIPLIER, DEFAULT_MARKUP_MULTIPLIER) || DEFAULT_MARKUP_MULTIPLIER;
}

function getCodRate(env: Env): number {
  return toNonNegativeNumber(env.CDEK_COD_RATE, DEFAULT_COD_RATE);
}

function getDefaultPackageMm(env: Env): { lengthMm: number; widthMm: number; heightMm: number } {
  return {
    lengthMm: toPositiveInt(env.CDEK_PACKAGE_LENGTH_MM, DEFAULT_PACKAGE_LENGTH_MM),
    widthMm: toPositiveInt(env.CDEK_PACKAGE_WIDTH_MM, DEFAULT_PACKAGE_WIDTH_MM),
    heightMm: toPositiveInt(env.CDEK_PACKAGE_HEIGHT_MM, DEFAULT_PACKAGE_HEIGHT_MM),
  };
}

function getDefaultItemWeightG(env: Env): number {
  return toPositiveInt(env.CDEK_ITEM_WEIGHT_G, DEFAULT_ITEM_WEIGHT_G);
}

function parseTariffCodes(raw: string | undefined): number[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => toPositiveInt(part.trim(), 0))
    .filter((code) => code > 0);
}

function getPreferredTariffCodes(env: Env, deliveryType: DeliveryType): number[] {
  const fallback = deliveryType === 'door' ? [137, 233] : [136, 234];
  const fromEnv = deliveryType === 'door'
    ? parseTariffCodes(env.CDEK_DOOR_TARIFF_CODES)
    : parseTariffCodes(env.CDEK_PICKUP_TARIFF_CODES);
  return fromEnv.length ? fromEnv : fallback;
}

function normalizeDeliveryType(input: unknown, pvzId: string): DeliveryType {
  if (pvzId) return 'pickup';
  return String(input || '').trim().toLowerCase() === 'door' ? 'door' : 'pickup';
}

function normalizePvzId(input: unknown): string {
  return String(input || '').trim();
}

function aggregatePackage(env: Env, payload: CalculatePayload): AggregatedPackage {
  const defaults = getDefaultPackageMm(env);
  const fallbackWeightG = getDefaultItemWeightG(env);
  const rows = Array.isArray(payload.items) ? payload.items : [];

  if (!rows.length) {
    return {
      weightG: fallbackWeightG,
      lengthMm: defaults.lengthMm,
      widthMm: defaults.widthMm,
      heightMm: defaults.heightMm,
      itemsTotal: toNonNegativeNumber(payload.itemsTotal ?? payload.orderTotal, 0),
    };
  }

  let totalWeightG = 0;
  let maxLengthMm = 1;
  let maxWidthMm = 1;
  let totalHeightMm = 0;
  let computedItemsTotal = 0;

  for (const row of rows) {
    const qty = toPositiveInt(row?.qty, 1);
    const weightG = toPositiveInt(row?.weight ?? row?.weightG, fallbackWeightG);
    const lengthMm = toPositiveInt(row?.length, defaults.lengthMm);
    const widthMm = toPositiveInt(row?.width, defaults.widthMm);
    const heightMm = toPositiveInt(row?.height, defaults.heightMm);

    totalWeightG += weightG * qty;
    maxLengthMm = Math.max(maxLengthMm, lengthMm);
    maxWidthMm = Math.max(maxWidthMm, widthMm);
    totalHeightMm += heightMm * qty;

    const price = toNonNegativeNumber(row?.price, 0);
    computedItemsTotal += price * qty;
  }

  const payloadItemsTotal = toNonNegativeNumber(payload.itemsTotal ?? payload.orderTotal, 0);

  return {
    weightG: Math.max(100, totalWeightG),
    lengthMm: Math.max(1, maxLengthMm),
    widthMm: Math.max(1, maxWidthMm),
    heightMm: Math.max(1, totalHeightMm),
    itemsTotal: payloadItemsTotal > 0 ? payloadItemsTotal : computedItemsTotal,
  };
}

function createMockBasePrice(deliveryType: DeliveryType, city: string, pkg: AggregatedPackage): number {
  const cityExtra = city.toLowerCase() === 'москва' ? 0 : 140;
  const weightExtra = Math.min(900, Math.ceil(pkg.weightG / 350) * 15);
  const volumeExtra = Math.min(500, Math.ceil((pkg.lengthMm * pkg.widthMm * pkg.heightMm) / 100000) * 10);
  const base = deliveryType === 'door' ? 340 : 240;
  return Math.max(1, Math.ceil(base + cityExtra + weightExtra + volumeExtra));
}

function applyMarkup(basePrice: number, markupMultiplier: number): { markupPrice: number; finalPrice: number } {
  const markupPrice = Math.max(0, basePrice) * markupMultiplier;
  const finalPrice = Math.ceil(markupPrice);
  return { markupPrice, finalPrice };
}

function formatEtaDays(min: number, max: number): string {
  if (min > 0 && max > 0) return min === max ? `${min} дн.` : `${min}-${max} дн.`;
  if (min > 0) return `${min} дн.`;
  if (max > 0) return `${max} дн.`;
  return 'срок уточняется';
}

async function fetchAccessToken(
  apiBase: string,
  credentials: { clientId: string; clientSecret: string },
  timeoutMs: number
): Promise<CdekAuthResult> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false, error: 'cdek_auth_failed' };

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(raw.access_token || '').trim();
    if (!token) return { ok: false, error: 'cdek_token_missing' };
    return { ok: true, token };
  } catch {
    return { ok: false, error: 'cdek_auth_unreachable' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveCityCode(
  apiBase: string,
  accessToken: string,
  city: string,
  zip: string,
  timeoutMs: number
): Promise<CdekCityResolveResult> {
  const params = new URLSearchParams({
    country_codes: 'RU',
    size: '5',
    city,
  });
  if (zip) params.set('postal_code', zip);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}/v2/location/cities?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false };

    const raw = (await response.json().catch(() => [])) as unknown;
    if (!Array.isArray(raw) || !raw.length) return { ok: true };

    const first = raw.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined;
    if (!first) return { ok: true };
    const code = toPositiveInt(first.code, 0);
    return code > 0 ? { ok: true, code } : { ok: true };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isFulfillmentTariff(name: string): boolean {
  return /фулфилмент|fulfillment/i.test(name);
}

function isPickupMode(mode: number): boolean {
  return mode === 2 || mode === 4;
}

function isDoorMode(mode: number): boolean {
  return mode === 1 || mode === 3;
}

function buildTariffCandidates(rawTariffs: Array<Record<string, unknown>>): TariffCandidate[] {
  return rawTariffs
    .map((entry) => ({
      tariffCode: toPositiveInt(entry.tariff_code, 0),
      tariffName: String(entry.tariff_name || '').trim(),
      totalSum: Number(entry.total_sum || entry.delivery_sum || entry.delivery_sum_with_vat || 0),
      periodMin: toPositiveInt(entry.period_min, 0),
      periodMax: toPositiveInt(entry.period_max, 0),
      deliveryMode: toPositiveInt(entry.delivery_mode, 0),
    }))
    .filter((entry) => entry.totalSum > 0 && entry.tariffCode > 0 && !isFulfillmentTariff(entry.tariffName));
}

function filterByDeliveryType(candidates: TariffCandidate[], deliveryType: DeliveryType): TariffCandidate[] {
  const preferred = candidates.filter((entry) =>
    deliveryType === 'door' ? isDoorMode(entry.deliveryMode) : isPickupMode(entry.deliveryMode)
  );
  return preferred.length ? preferred : candidates;
}

function pickBestTariff(candidates: TariffCandidate[], preferredCodes: number[]): TariffCandidate | null {
  if (!candidates.length) return null;

  const preferredIndex = new Map<number, number>();
  preferredCodes.forEach((code, index) => preferredIndex.set(code, index));

  return [...candidates].sort((a, b) => {
    const aPref = preferredIndex.has(a.tariffCode) ? preferredIndex.get(a.tariffCode)! : Number.MAX_SAFE_INTEGER;
    const bPref = preferredIndex.has(b.tariffCode) ? preferredIndex.get(b.tariffCode)! : Number.MAX_SAFE_INTEGER;
    if (aPref !== bPref) return aPref - bPref;
    return a.totalSum - b.totalSum;
  })[0];
}

function buildSuccessResponse(input: {
  mode: string;
  quoteTitle: string;
  deliveryDays: number;
  tariffCode?: number;
  basePrice: number;
  finalPrice: number;
  codFee: number;
  traceId: string;
  warning?: string;
  raw?: unknown;
}) {
  const etaText = input.deliveryDays > 0 ? `${input.deliveryDays} дней` : 'срок уточняется';
  const quote: CdekQuote = {
    provider: 'cdek',
    title: input.quoteTitle,
    priceRub: input.finalPrice,
    etaDays: etaText,
    tariffCode: input.tariffCode,
  };

  return {
    ok: true,
    mode: input.mode,
    quote,
    basePrice: input.basePrice,
    finalPrice: input.finalPrice,
    tariffCode: input.tariffCode || 0,
    deliveryDays: input.deliveryDays,
    ...(input.codFee > 0 ? { codFee: input.codFee } : {}),
    ...(input.warning ? { warning: input.warning } : {}),
    ...(input.raw ? { raw: input.raw } : {}),
    traceId: input.traceId,
  };
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const traceId = toTraceId();
  const { request, env } = context;

  let body: CalculatePayload;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'bad_request', traceId });
  }

  const city = String(body.city || '').trim();
  const zip = String(body.zip || '').trim();
  const pvzId = normalizePvzId(body.pvzId);
  const deliveryType = normalizeDeliveryType(body.deliveryType, pvzId);

  if (!city) {
    return json(400, { ok: false, error: 'missing_city', traceId });
  }

  const pkg = aggregatePackage(env, body);
  const preferredTariffCodes = getPreferredTariffCodes(env, deliveryType);
  const markupMultiplier = getMarkupMultiplier(env);
  const codRate = getCodRate(env);
  const codFee = body.cod ? Math.ceil(pkg.itemsTotal * codRate) : 0;

  const mockBasePrice = createMockBasePrice(deliveryType, city, pkg);
  const mockMarkup = applyMarkup(mockBasePrice, markupMultiplier);

  if (isMockMode(env)) {
    console.log(JSON.stringify({
      event: 'cdek_calculate',
      mode: 'mock',
      weight: pkg.weightG,
      dimensions: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
      base_price: mockBasePrice,
      markup_price: mockMarkup.markupPrice,
      final_price: mockMarkup.finalPrice,
      tariff_code: deliveryType === 'door' ? 137 : 136,
    }));

    return json(200, buildSuccessResponse({
      mode: 'mock',
      quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
      deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
      tariffCode: deliveryType === 'door' ? 137 : 136,
      basePrice: mockBasePrice,
      finalPrice: mockMarkup.finalPrice,
      codFee,
      traceId,
    }));
  }

  const credentials = getCdekCredentials(env);
  if (!credentials) {
    return json(200, buildSuccessResponse({
      mode: 'mock_not_configured',
      quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
      deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
      tariffCode: deliveryType === 'door' ? 137 : 136,
      basePrice: mockBasePrice,
      finalPrice: mockMarkup.finalPrice,
      codFee,
      traceId,
      warning: 'cdek_not_configured',
    }));
  }

  const timeoutMs = getTimeoutMs(env);
  const apiBase = getApiBase(env);
  const senderCityCode = getSenderCityCode(env);

  const auth = await fetchAccessToken(apiBase, credentials, timeoutMs);
  if (!auth.ok) {
    return json(200, buildSuccessResponse({
      mode: 'mock_fallback',
      quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
      deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
      tariffCode: deliveryType === 'door' ? 137 : 136,
      basePrice: mockBasePrice,
      finalPrice: mockMarkup.finalPrice,
      codFee,
      traceId,
      warning: auth.error,
    }));
  }

  const cityResolve = await resolveCityCode(apiBase, auth.token, city, zip, timeoutMs);
  const toLocation: Record<string, unknown> = cityResolve.ok && cityResolve.code
    ? { code: cityResolve.code }
    : { country_code: 'RU', city, ...(zip ? { postal_code: zip } : {}) };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}/v2/calculator/tarifflist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        from_location: { code: senderCityCode },
        to_location: toLocation,
        tariff_codes: preferredTariffCodes,
        packages: [
          {
            weight: pkg.weightG,
            length: mmToCm(pkg.lengthMm),
            width: mmToCm(pkg.widthMm),
            height: mmToCm(pkg.heightMm),
          },
        ],
      }),
      signal: controller.signal,
    });

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tariffs = Array.isArray(raw?.tariff_codes) ? raw.tariff_codes : [];

    if (!response.ok || !tariffs.length) {
      return json(200, buildSuccessResponse({
        mode: 'mock_fallback',
        quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
        deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
        tariffCode: deliveryType === 'door' ? 137 : 136,
        basePrice: mockBasePrice,
        finalPrice: mockMarkup.finalPrice,
        codFee,
        traceId,
        warning: 'cdek_calculate_failed',
        raw,
      }));
    }

    const candidates = tariffs
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .filter(Boolean) as Array<Record<string, unknown>>;
    const prepared = buildTariffCandidates(candidates);
    const filtered = filterByDeliveryType(prepared, deliveryType);
    const best = pickBestTariff(filtered, preferredTariffCodes);

    if (!best) {
      return json(200, buildSuccessResponse({
        mode: 'mock_fallback',
        quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
        deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
        tariffCode: deliveryType === 'door' ? 137 : 136,
        basePrice: mockBasePrice,
        finalPrice: mockMarkup.finalPrice,
        codFee,
        traceId,
        warning: 'cdek_tariff_parse_failed',
        raw,
      }));
    }

    const basePrice = Math.ceil(toNonNegativeNumber(best.totalSum, 0));
    const { markupPrice, finalPrice } = applyMarkup(basePrice, markupMultiplier);
    const deliveryDays = Math.max(best.periodMax || best.periodMin || 0, 0);

    // Русский комментарий: детальный лог расчета для отладки бизнес-формулы.
    console.log(JSON.stringify({
      event: 'cdek_calculate',
      mode: 'live',
      weight: pkg.weightG,
      dimensions: { length: pkg.lengthMm, width: pkg.widthMm, height: pkg.heightMm },
      base_price: basePrice,
      markup_price: markupPrice,
      final_price: finalPrice,
      tariff_code: best.tariffCode,
      delivery_mode: deliveryType,
      pvz_id: pvzId || null,
      delivery_days: deliveryDays,
      cod_fee: codFee,
      traceId,
    }));

    const liveTitle = best.tariffName || (deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ');

    return json(200, {
      ...buildSuccessResponse({
        mode: 'live',
        quoteTitle: liveTitle,
        deliveryDays,
        tariffCode: best.tariffCode || undefined,
        basePrice,
        finalPrice,
        codFee,
        traceId,
      }),
      quote: {
        provider: 'cdek',
        title: liveTitle,
        priceRub: finalPrice,
        etaDays: formatEtaDays(best.periodMin, best.periodMax),
        tariffCode: best.tariffCode || undefined,
      },
    });
  } catch {
    return json(200, buildSuccessResponse({
      mode: 'mock_fallback',
      quoteTitle: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
      deliveryDays: city.toLowerCase() === 'москва' ? 2 : 5,
      tariffCode: deliveryType === 'door' ? 137 : 136,
      basePrice: mockBasePrice,
      finalPrice: mockMarkup.finalPrice,
      codFee,
      traceId,
      warning: 'cdek_unreachable',
    }));
  } finally {
    clearTimeout(timeoutId);
  }
};
