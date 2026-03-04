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

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TEST_API_BASE = 'https://api.edu.cdek.ru';
const DEFAULT_PROD_API_BASE = 'https://api.cdek.ru';
const DEFAULT_SENDER_CITY_CODE = 44; // Москва

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

function createMockQuote(items: Array<{ qty: number }>, city: string): CdekQuote {
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const base = 290;
  const perItem = Math.min(650, totalQty * 45);
  const cityExtra = city.toLowerCase() === 'москва' ? 0 : 140;
  const priceRub = base + perItem + cityExtra;

  return {
    provider: 'cdek',
    title: 'СДЭК до ПВЗ',
    priceRub,
    etaDays: city.toLowerCase() === 'москва' ? '1-2 дня' : '2-5 дней',
    tariffCode: 136,
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
  const apartment = String(body.apartment || '').trim();
  const items = normalizeItems(body.items);

  if (!city || !zip || !street) {
    return json(400, { ok: false, error: 'missing_address_fields', traceId });
  }
  if (!items.length) {
    return json(400, { ok: false, error: 'empty_items', traceId });
  }

  const mockQuote = createMockQuote(items, city);
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
        date: new Date().toISOString().slice(0, 10),
        from_location: { code: senderCityCode },
        to_location: toLocation,
        packages: [
          {
            weight: totalWeightG,
            length: 20,
            width: 20,
            height: 10,
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

    const best = tariffCandidates
      .map((entry) => ({
        tariffCode: toPositiveInt(entry.tariff_code, 0),
        tariffName: String(entry.tariff_name || '').trim(),
        totalSum: Number(entry.total_sum || entry.delivery_sum || entry.delivery_sum_with_vat || 0),
        periodMin: toPositiveInt(entry.period_min, 0),
        periodMax: toPositiveInt(entry.period_max, 0),
      }))
      .filter((entry) => entry.totalSum > 0)
      .sort((a, b) => a.totalSum - b.totalSum)[0];

    if (!best) {
      return json(200, {
        ok: true,
        mode: 'mock_fallback',
        quote: mockQuote,
        warning: 'cdek_tariff_parse_failed',
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
      title: best.tariffName || 'СДЭК Доставка',
      priceRub: toPositiveInt(best.totalSum, mockQuote.priceRub),
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
