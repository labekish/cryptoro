import { guardMutationRequest } from '../../_lib/request-guard';

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
  CDEK_CREATE_ORDER?: string;
  CDEK_PICKUP_TARIFF_CODES?: string;
  CDEK_DOOR_TARIFF_CODES?: string;
  CDEK_PACKAGE_LENGTH_MM?: string;
  CDEK_PACKAGE_WIDTH_MM?: string;
  CDEK_PACKAGE_HEIGHT_MM?: string;
  CDEK_SENDER_NAME?: string;
  CDEK_SENDER_PHONE?: string;
  CDEK_SENDER_ADDRESS?: string;
};

type DeliveryType = 'pickup' | 'door';

type CreateOrderItem = {
  sku?: string;
  name?: string;
  qty?: number;
  price?: number;
  weightG?: number;
};

export type CdekCreateOrderPayload = {
  orderId?: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  street?: string;
  apartment?: string;
  zip?: string;
  deliveryType?: DeliveryType;
  tariffCode?: number;
  comment?: string;
  items?: CreateOrderItem[];
};

type CdekCreateOrderMode =
  | 'live'
  | 'live_exists'
  | 'mock'
  | 'mock_not_configured'
  | 'mock_fallback'
  | 'disabled';

export type CdekCreateOrderResult =
  | {
    ok: true;
    mode: CdekCreateOrderMode;
    traceId: string;
    order?: {
      uuid?: string;
      cdekNumber?: string;
      status?: string;
    };
    warning?: string;
    raw?: unknown;
  }
  | {
    ok: false;
    error: string;
    traceId: string;
  };

type CdekAuthSuccess = { ok: true; token: string };
type CdekAuthError = { ok: false; error: string };
type CdekAuthResult = CdekAuthSuccess | CdekAuthError;
type CdekCityResolveResult = { ok: true; code?: number } | { ok: false };

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_TEST_API_BASE = 'https://api.edu.cdek.ru';
const DEFAULT_PROD_API_BASE = 'https://api.cdek.ru';
const DEFAULT_SENDER_CITY_CODE = 44; // Москва
const DEFAULT_PACKAGE_LENGTH_MM = 86;
const DEFAULT_PACKAGE_WIDTH_MM = 54;
const DEFAULT_PACKAGE_HEIGHT_MM = 3;
const DEFAULT_PICKUP_TARIFF_CODE = 136;
const DEFAULT_DOOR_TARIFF_CODE = 137;
const DEFAULT_SENDER_NAME = 'CRYPTORO';
const DEFAULT_SENDER_PHONE = '+74951918174';

function toTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function normalizePhone(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

function sanitizeText(input: unknown, maxLength: number): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function isMockMode(env: Env): boolean {
  return String(env.CDEK_MOCK || '').trim() === '1';
}

function isCreateOrderEnabled(env: Env): boolean {
  return String(env.CDEK_CREATE_ORDER || '1').trim() !== '0';
}

function isTestMode(env: Env): boolean {
  return String(env.CDEK_TEST_MODE || '').trim() === '1';
}

function getCdekCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  const clientId = sanitizeText(env.CDEK_CLIENT_ID || env.CDEK_ACCOUNT, 200);
  const clientSecret = sanitizeText(env.CDEK_CLIENT_SECRET || env.CDEK_SECURE, 200);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getApiBase(env: Env): string {
  const raw = sanitizeText(env.CDEK_API_BASE, 200);
  if (raw) return raw.replace(/\/$/, '');
  return isTestMode(env) ? DEFAULT_TEST_API_BASE : DEFAULT_PROD_API_BASE;
}

function getSenderCityCode(env: Env): number {
  return toPositiveInt(env.CDEK_SENDER_CITY_CODE, DEFAULT_SENDER_CITY_CODE);
}

function getTimeoutMs(env: Env): number {
  return toPositiveInt(env.CDEK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
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

function normalizeDeliveryType(input: unknown): DeliveryType {
  return String(input || '').trim().toLowerCase() === 'door' ? 'door' : 'pickup';
}

function getTariffCode(payload: CdekCreateOrderPayload, env: Env, deliveryType: DeliveryType): number {
  const fromPayload = toPositiveInt(payload.tariffCode, 0);
  if (fromPayload > 0) return fromPayload;

  const fromEnv = deliveryType === 'door'
    ? parseTariffCodes(env.CDEK_DOOR_TARIFF_CODES)[0]
    : parseTariffCodes(env.CDEK_PICKUP_TARIFF_CODES)[0];
  if (fromEnv && fromEnv > 0) return fromEnv;

  return deliveryType === 'door' ? DEFAULT_DOOR_TARIFF_CODE : DEFAULT_PICKUP_TARIFF_CODE;
}

function normalizeItems(items: CreateOrderItem[] | undefined): Array<{ name: string; qty: number; price: number; weightG: number; sku?: string }> {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const qty = toPositiveInt(item?.qty, 1);
      const price = toNonNegativeInt(item?.price, 0);
      const weightG = toPositiveInt(item?.weightG, 80);
      const name = sanitizeText(item?.name, 140);
      const sku = sanitizeText(item?.sku, 80) || undefined;
      return { name, qty, price, weightG, sku };
    })
    .filter((item) => item.name && item.qty > 0);
}

function totalWeight(items: Array<{ qty: number; weightG: number }>): number {
  const total = items.reduce((sum, item) => sum + item.qty * item.weightG, 0);
  return Math.max(100, total);
}

function extractErrorMessages(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const errors = (raw as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) return [];

  return errors
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      return sanitizeText((entry as Record<string, unknown>).message, 300);
    })
    .filter(Boolean);
}

function isDuplicateOrderError(raw: unknown): boolean {
  const messages = extractErrorMessages(raw).join(' | ').toLowerCase();
  if (!messages) return false;
  return (
    messages.includes('уже существует') ||
    messages.includes('already exists') ||
    messages.includes('duplicate') ||
    messages.includes('number has been used')
  );
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
    const token = sanitizeText(raw.access_token, 5000);
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

export async function createCdekOrder(env: Env, payload: CdekCreateOrderPayload): Promise<CdekCreateOrderResult> {
  const traceId = toTraceId();

  const orderId = sanitizeText(payload.orderId, 80);
  const recipientName = sanitizeText(payload.name, 120);
  const recipientPhone = normalizePhone(sanitizeText(payload.phone, 80));
  const recipientEmail = sanitizeText(payload.email, 120);
  const city = sanitizeText(payload.city, 120);
  const street = sanitizeText(payload.street, 160);
  const apartment = sanitizeText(payload.apartment, 120);
  const zip = sanitizeText(payload.zip, 20);
  const deliveryType = normalizeDeliveryType(payload.deliveryType);
  const items = normalizeItems(payload.items);

  if (!orderId || !recipientName || !recipientPhone || !city || !street || !zip || !items.length) {
    return { ok: false, error: 'missing_required_fields', traceId };
  }

  if (!isCreateOrderEnabled(env)) {
    return { ok: true, mode: 'disabled', traceId, warning: 'cdek_create_order_disabled' };
  }

  const mockOrder = {
    uuid: `mock-${orderId.toLowerCase()}`,
    cdekNumber: orderId,
    status: 'CREATED',
  };

  if (isMockMode(env)) {
    return { ok: true, mode: 'mock', traceId, order: mockOrder };
  }

  const credentials = getCdekCredentials(env);
  if (!credentials) {
    return { ok: true, mode: 'mock_not_configured', traceId, order: mockOrder, warning: 'cdek_not_configured' };
  }

  const apiBase = getApiBase(env);
  const timeoutMs = getTimeoutMs(env);
  const senderCityCode = getSenderCityCode(env);
  const packageSizeCm = getPackageSizeCm(env);
  const tariffCode = getTariffCode(payload, env, deliveryType);

  const auth = await fetchAccessToken(apiBase, credentials, timeoutMs);
  if (!auth.ok) {
    return {
      ok: true,
      mode: 'mock_fallback',
      traceId,
      order: mockOrder,
      warning: auth.error,
    };
  }

  const cityResolve = await resolveCityCode(apiBase, auth.token, city, zip, timeoutMs);
  const senderName = sanitizeText(env.CDEK_SENDER_NAME, 120) || DEFAULT_SENDER_NAME;
  const senderPhone = normalizePhone(sanitizeText(env.CDEK_SENDER_PHONE, 80) || DEFAULT_SENDER_PHONE);
  const senderAddress = sanitizeText(env.CDEK_SENDER_ADDRESS, 200);
  const recipientAddress = [street, apartment].filter(Boolean).join(', ');
  const totalWeightG = totalWeight(items);

  const toLocation: Record<string, unknown> = cityResolve.ok && cityResolve.code
    ? {
      code: cityResolve.code,
      country_code: 'RU',
      address: recipientAddress,
    }
    : {
      country_code: 'RU',
      city,
      postal_code: zip,
      address: recipientAddress,
    };

  const orderBody = {
    number: orderId,
    tariff_code: tariffCode,
    comment: sanitizeText(payload.comment, 255) || `Заказ с сайта CRYPTORO #${orderId}`,
    sender: {
      name: senderName,
      phones: [{ number: senderPhone }],
    },
    recipient: {
      name: recipientName,
      ...(recipientEmail ? { email: recipientEmail } : {}),
      phones: [{ number: recipientPhone }],
    },
    from_location: {
      code: senderCityCode,
      country_code: 'RU',
      ...(senderAddress ? { address: senderAddress } : {}),
    },
    to_location: toLocation,
    packages: [
      {
        number: `${orderId}-1`,
        weight: totalWeightG,
        length: packageSizeCm.length,
        width: packageSizeCm.width,
        height: packageSizeCm.height,
        items: items.map((item, index) => ({
          name: item.name,
          ware_key: item.sku || `${orderId}-${index + 1}`,
          payment: { value: 0 },
          cost: item.price,
          weight: item.weightG,
          amount: item.qty,
        })),
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBase}/v2/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(orderBody),
      signal: controller.signal,
    });

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      if (isDuplicateOrderError(raw)) {
        return {
          ok: true,
          mode: 'live_exists',
          traceId,
          warning: 'cdek_order_exists',
          order: {
            cdekNumber: orderId,
          },
          raw,
        };
      }
      return {
        ok: true,
        mode: 'mock_fallback',
        traceId,
        order: mockOrder,
        warning: 'cdek_create_failed',
        raw,
      };
    }

    const entity = (raw?.entity && typeof raw.entity === 'object' ? raw.entity : raw) as Record<string, unknown>;
    const statusList = Array.isArray(entity.statuses) ? entity.statuses : [];
    const firstStatus = statusList[0] && typeof statusList[0] === 'object'
      ? statusList[0] as Record<string, unknown>
      : null;

    return {
      ok: true,
      mode: 'live',
      traceId,
      order: {
        uuid: sanitizeText(entity.uuid, 120),
        cdekNumber: sanitizeText(entity.cdek_number || entity.number, 120) || orderId,
        status: sanitizeText(firstStatus?.name || firstStatus?.code, 120),
      },
    };
  } catch {
    return {
      ok: true,
      mode: 'mock_fallback',
      traceId,
      order: mockOrder,
      warning: 'cdek_create_unreachable',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const headers = { 'Content-Type': 'application/json' };
  const { request, env } = context;
  const guard = await guardMutationRequest(request, env, { scope: 'cdek_create_order', maxPerWindow: 20, windowSec: 60 });
  if (!guard.ok) {
    return new Response(JSON.stringify({ ok: false, error: guard.error }), { status: guard.status, headers });
  }

  let body: CdekCreateOrderPayload;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 400, headers });
  }

  const result = await createCdekOrder(env, body);
  if (!result.ok) {
    return new Response(JSON.stringify(result), { status: 400, headers });
  }
  return new Response(JSON.stringify(result), { status: 200, headers });
};
