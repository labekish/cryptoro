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
  CDEK_SURCHARGE_RUB?: string;
  CDEK_PICKUP_TARIFF_CODES?: string;
  CDEK_DOOR_TARIFF_CODES?: string;
  CDEK_PACKAGE_LENGTH_MM?: string;
  CDEK_PACKAGE_WIDTH_MM?: string;
  CDEK_PACKAGE_HEIGHT_MM?: string;
};

type CartItem = {
  sku?: string;
  name?: string;
  qty?: number;
  price?: number;
  weightG?: number;
};

type CalculatePayload = {
  city?: string;
  zip?: string;
  street?: string;
  apartment?: string;
  items?: CartItem[];
  orderTotal?: number;
  deliveryType?: 'pickup' | 'door';
};

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
type DeliveryType = 'pickup' | 'door';

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TEST_API_BASE = 'https://api.edu.cdek.ru';
const DEFAULT_PROD_API_BASE = 'https://api.cdek.ru';
const DEFAULT_SENDER_CITY_CODE = 44; // Москва
const DEFAULT_SURCHARGE_RUB = 100;
const DEFAULT_PACKAGE_LENGTH_MM = 86;
const DEFAULT_PACKAGE_WIDTH_MM = 54;
const DEFAULT_PACKAGE_HEIGHT_MM = 3;

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

function toNonNegativeInt(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
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
  // Русский комментарий: поддерживаем оба нейминга переменных, чтобы не ломать текущие окружения.
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

function getSurchargeRub(env: Env): number {
  return toNonNegativeInt(env.CDEK_SURCHARGE_RUB, DEFAULT_SURCHARGE_RUB);
}

function getPackageSizeCm(env: Env): { length: number; width: number; height: number } {
  const lengthMm = toPositiveInt(env.CDEK_PACKAGE_LENGTH_MM, DEFAULT_PACKAGE_LENGTH_MM);
  const widthMm = toPositiveInt(env.CDEK_PACKAGE_WIDTH_MM, DEFAULT_PACKAGE_WIDTH_MM);
  const heightMm = toPositiveInt(env.CDEK_PACKAGE_HEIGHT_MM, DEFAULT_PACKAGE_HEIGHT_MM);
  return {
    length: mmToCm(lengthMm),
    width: mmToCm(widthMm),
    height: mmToCm(heightMm),
  };
}

function parseTariffCodes(raw: string | undefined): number[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => toPositiveInt(part.trim(), 0))
    .filter((code) => code > 0);
}

function getPreferredTariffCodes(env: Env, deliveryType: DeliveryType): number[] {
  return deliveryType === 'door'
    ? parseTariffCodes(env.CDEK_DOOR_TARIFF_CODES)
    : parseTariffCodes(env.CDEK_PICKUP_TARIFF_CODES);
}

function normalizeDeliveryType(input: unknown): DeliveryType {
  return String(input || '').trim().toLowerCase() === 'door' ? 'door' : 'pickup';
}

function normalizeItems(input: CartItem[] | undefined): Array<{ name: string; qty: number; price: number; weightG: number; sku?: string }> {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const qty = toPositiveInt(item?.qty, 1);
      const price = toPositiveInt(item?.price, 0);
      const name = String(item?.name || '').trim();
      const sku = String(item?.sku || '').trim() || undefined;
      const weightG = toPositiveInt(item?.weightG, 450);
      return { name, qty, price, weightG, sku };
    })
    .filter((item) => item.name && item.qty > 0);
}

function calculateTotalWeight(items: Array<{ qty: number; weightG: number }>): number {
  const sumG = items.reduce((sum, item) => sum + item.qty * item.weightG, 0);
  return Math.max(100, sumG);
}

function createMockQuote(
  items: Array<{ qty: number }>,
  city: string,
  deliveryType: DeliveryType,
  surchargeRub: number
): CdekQuote {
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const base = deliveryType === 'door' ? 420 : 290;
  const perItem = Math.min(650, totalQty * 45);
  const cityExtra = city.toLowerCase() === 'москва' ? 0 : 140;
  const priceRub = base + perItem + cityExtra + surchargeRub;

  return {
    provider: 'cdek',
    title: deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ',
    priceRub,
    etaDays: city.toLowerCase() === 'москва' ? '1-2 дня' : '2-5 дней',
    tariffCode: deliveryType === 'door' ? 137 : 136,
  };
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
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false };
    const raw = (await response.json().catch(() => [])) as unknown;
    if (!Array.isArray(raw) || !raw.length) return { ok: true };

    // Русский комментарий: берём первый подходящий город из справочника СДЭК.
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

type TariffCandidate = {
  tariffCode: number;
  tariffName: string;
  totalSum: number;
  periodMin: number;
  periodMax: number;
  deliveryMode: number;
};

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
  if (preferred.length) return preferred;
  // Русский комментарий: если mode не пришёл, fallback на все нефулфилмент-тарифы.
  return candidates;
}

function pickBestTariff(
  candidates: TariffCandidate[],
  preferredCodes: number[]
): TariffCandidate | null {
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
  const street = String(body.street || '').trim();
  const items = normalizeItems(body.items);
  const deliveryType = normalizeDeliveryType(body.deliveryType);

  if (!city || !zip || !street) {
    return json(400, { ok: false, error: 'missing_address_fields', traceId });
  }
  if (!items.length) {
    return json(400, { ok: false, error: 'empty_items', traceId });
  }

  const surchargeRub = getSurchargeRub(env);
  const mockQuote = createMockQuote(items, city, deliveryType, surchargeRub);
  if (isMockMode(env)) {
    return json(200, { ok: true, mode: 'mock', quote: mockQuote, traceId });
  }

  const credentials = getCdekCredentials(env);
  if (!credentials) {
    return json(200, { ok: true, mode: 'mock_not_configured', quote: mockQuote, traceId });
  }

  const timeoutMs = toPositiveInt(env.CDEK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const apiBase = getApiBase(env);
  const senderCityCode = getSenderCityCode(env);
  const packageSizeCm = getPackageSizeCm(env);
  const preferredTariffCodes = getPreferredTariffCodes(env, deliveryType);

  const auth = await fetchAccessToken(apiBase, credentials, timeoutMs);
  if (!auth.ok) {
    return json(200, {
      ok: true,
      mode: 'mock_fallback',
      quote: mockQuote,
      warning: auth.error,
      traceId,
    });
  }

  const totalWeightG = calculateTotalWeight(items);
  const cityResolve = await resolveCityCode(apiBase, auth.token, city, zip, timeoutMs);
  const toLocation: Record<string, unknown> = cityResolve.ok && cityResolve.code
    ? { code: cityResolve.code }
    : {
      country_code: 'RU',
      city,
      postal_code: zip,
    };
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
        // Русский комментарий: поле date не отправляем, чтобы СДЭК взял текущую дату по умолчанию.
        from_location: { code: senderCityCode },
        to_location: toLocation,
        packages: [
          {
            weight: totalWeightG,
            length: packageSizeCm.length,
            width: packageSizeCm.width,
            height: packageSizeCm.height,
          },
        ],
      }),
      signal: controller.signal,
    });

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const tariffs = Array.isArray(raw?.tariff_codes) ? raw.tariff_codes : [];

    if (!response.ok || !tariffs.length) {
      return json(200, {
        ok: true,
        mode: 'mock_fallback',
        quote: mockQuote,
        warning: 'cdek_calculate_failed',
        raw,
        toLocation,
        traceId,
      });
    }

    const tariffCandidates = tariffs
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .filter(Boolean) as Array<Record<string, unknown>>;
    const prepared = buildTariffCandidates(tariffCandidates);
    const filteredByType = filterByDeliveryType(prepared, deliveryType);
    const best = pickBestTariff(filteredByType, preferredTariffCodes);

    if (!best) {
      return json(200, {
        ok: true,
        mode: 'mock_fallback',
        quote: mockQuote,
        warning: 'cdek_tariff_parse_failed',
        raw,
        deliveryType,
        traceId,
      });
    }

    const etaDays = best.periodMin > 0 && best.periodMax > 0
      ? `${best.periodMin}-${best.periodMax} дней`
      : best.periodMin > 0
        ? `${best.periodMin} дней`
        : mockQuote.etaDays;

    const liveQuote: CdekQuote = {
      provider: 'cdek',
      title: best.tariffName || (deliveryType === 'door' ? 'СДЭК до двери' : 'СДЭК до ПВЗ'),
      priceRub: toPositiveInt(best.totalSum + surchargeRub, mockQuote.priceRub),
      etaDays,
      tariffCode: best.tariffCode || undefined,
    };

    return json(200, { ok: true, mode: 'live', quote: liveQuote, traceId });
  } catch {
    return json(200, {
      ok: true,
      mode: 'mock_fallback',
      quote: mockQuote,
      warning: 'cdek_unreachable',
      traceId,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
