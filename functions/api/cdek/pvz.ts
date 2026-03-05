type Env = {
  CDEK_CLIENT_ID?: string;
  CDEK_CLIENT_SECRET?: string;
  CDEK_ACCOUNT?: string;
  CDEK_SECURE?: string;
  CDEK_API_BASE?: string;
  CDEK_TIMEOUT_MS?: string;
  CDEK_MOCK?: string;
  CDEK_TEST_MODE?: string;
};

type PvzItem = {
  id: string;
  code: string;
  name: string;
  address: string;
  city?: string;
  postalCode?: string;
  workTime?: string;
};

type CdekAuthSuccess = { ok: true; token: string };
type CdekAuthError = { ok: false; error: string };
type CdekAuthResult = CdekAuthSuccess | CdekAuthError;
type CdekCityResolveResult = { ok: true; code?: number } | { ok: false };

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TEST_API_BASE = 'https://api.edu.cdek.ru';
const DEFAULT_PROD_API_BASE = 'https://api.cdek.ru';

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

function isTestMode(env: Env): boolean {
  return String(env.CDEK_TEST_MODE || '').trim() === '1';
}

function isMockMode(env: Env): boolean {
  return String(env.CDEK_MOCK || '').trim() === '1';
}

function getApiBase(env: Env): string {
  const raw = String(env.CDEK_API_BASE || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return isTestMode(env) ? DEFAULT_TEST_API_BASE : DEFAULT_PROD_API_BASE;
}

function getCdekCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = String(env.CDEK_CLIENT_ID || env.CDEK_ACCOUNT || '').trim();
  const clientSecret = String(env.CDEK_CLIENT_SECRET || env.CDEK_SECURE || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getTimeoutMs(env: Env): number {
  return toPositiveInt(env.CDEK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function normalizeCity(input: unknown): string {
  return String(input || '').trim();
}

function normalizeStreet(input: unknown): string {
  return String(input || '').trim().toLowerCase();
}

function normalizeZip(input: unknown): string {
  return String(input || '').trim().replace(/\D/g, '').slice(0, 6);
}

function tokenizeStreet(input: string): string[] {
  return input
    .replace(/[.,/]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function extractHouseToken(input: string): string {
  const m = input.match(/\b\d+[а-яa-z0-9/-]*/i);
  return m?.[0]?.toLowerCase() || '';
}

function mapPvz(list: unknown): PvzItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const code = String(row.code || '').trim();
      if (!code) return null;
      const location = row.location && typeof row.location === 'object'
        ? (row.location as Record<string, unknown>)
        : {};
      return {
        id: code,
        code,
        name: String(row.name || row.full_address || '').trim() || code,
        address: String(location.address || location.address_full || '').trim(),
        city: String(location.city || '').trim() || undefined,
        postalCode: String(location.postal_code || '').trim() || undefined,
        workTime: String(row.work_time || '').trim() || undefined,
      } as PvzItem;
    })
    .filter((row): row is PvzItem => Boolean(row));
}

function mockPvz(city: string): PvzItem[] {
  return [
    {
      id: 'MSK001',
      code: 'MSK001',
      name: `СДЭК ПВЗ ${city || 'Москва'} #1`,
      address: 'Тестовый адрес, 1',
      city: city || 'Москва',
      workTime: 'Пн-Вс 10:00-21:00',
    },
    {
      id: 'MSK002',
      code: 'MSK002',
      name: `СДЭК ПВЗ ${city || 'Москва'} #2`,
      address: 'Тестовый адрес, 2',
      city: city || 'Москва',
      workTime: 'Пн-Сб 09:00-20:00',
    },
  ];
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
  timeoutMs: number
): Promise<CdekCityResolveResult> {
  const params = new URLSearchParams({
    country_codes: 'RU',
    size: '5',
    city,
  });

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

async function fetchPvzList(
  apiBase: string,
  token: string,
  cityCode: number,
  timeoutMs: number,
  zip: string
): Promise<PvzItem[]> {
  const params = new URLSearchParams({
    country_codes: 'RU',
    city_code: String(cityCode),
    type: 'PVZ',
    size: '200',
  });
  if (zip.length === 6) params.set('postal_code', zip);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}/v2/deliverypoints?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!response.ok) return [];
    const raw = await response.json().catch(() => []);
    return mapPvz(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}

function rankAndLimitPvz(points: PvzItem[], street: string, zip: string, limit = 30): PvzItem[] {
  if (!points.length) return [];

  const streetTokens = tokenizeStreet(street);
  const houseToken = extractHouseToken(street);

  const scored = points.map((point) => {
    const hay = `${String(point.name || '')} ${String(point.address || '')}`.toLowerCase();
    let score = 0;

    if (zip && point.postalCode === zip) score += 80;
    for (const token of streetTokens) {
      if (hay.includes(token)) score += 12;
    }
    if (houseToken && hay.includes(houseToken)) score += 35;

    return { point, score };
  });

  const hasAnyScore = scored.some((item) => item.score > 0);
  if (!hasAnyScore) return points.slice(0, limit);

  return scored
    .sort((a, b) => b.score - a.score)
    .map((item) => item.point)
    .slice(0, limit);
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const city = normalizeCity(url.searchParams.get('city'));
  const street = normalizeStreet(url.searchParams.get('street'));
  const zip = normalizeZip(url.searchParams.get('zip'));

  if (!city) return json(400, { ok: false, error: 'missing_city' });

  if (isMockMode(env)) {
    return json(200, { ok: true, mode: 'mock', points: mockPvz(city) });
  }

  const credentials = getCdekCredentials(env);
  if (!credentials) {
    return json(200, { ok: true, mode: 'mock_not_configured', points: mockPvz(city) });
  }

  const apiBase = getApiBase(env);
  const timeoutMs = getTimeoutMs(env);
  const auth = await fetchAccessToken(apiBase, credentials, timeoutMs);

  if (!auth.ok) {
    return json(200, { ok: true, mode: 'mock_fallback', points: mockPvz(city), warning: auth.error });
  }

  const cityResolve = await resolveCityCode(apiBase, auth.token, city, timeoutMs);
  const cityCode = cityResolve.ok ? toPositiveInt(cityResolve.code, 0) : 0;
  if (!cityCode) {
    return json(200, { ok: true, mode: 'live', points: [] });
  }

  const points = await fetchPvzList(apiBase, auth.token, cityCode, timeoutMs, zip);
  const ranked = rankAndLimitPvz(points, street, zip, 30);
  return json(200, { ok: true, mode: 'live', cityCode, points: ranked });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  let body: { city?: string; street?: string; zip?: string } = {};

  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }

  const city = normalizeCity(body.city);
  if (!city) return json(400, { ok: false, error: 'missing_city' });

  // Русский комментарий: POST-обертка, чтобы фронт мог отправлять JSON, если нужно.
  const url = new URL(request.url);
  url.searchParams.set('city', city);
  if (normalizeStreet(body.street)) url.searchParams.set('street', String(body.street || '').trim());
  if (normalizeZip(body.zip)) url.searchParams.set('zip', normalizeZip(body.zip));
  const fakeReq = new Request(url.toString(), { method: 'GET', headers: request.headers });
  return onRequestGet({ request: fakeReq, env });
};
