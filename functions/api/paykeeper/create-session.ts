import { guardMutationRequest } from '../../_lib/request-guard';

type Env = {
  PK_SERVER_URL?: string;
  PK_USER?: string;
  PK_PASSWORD?: string;
  PK_MOCK?: string;
  PK_TOKEN_PATH?: string;
  PK_CREATE_INVOICE_PATH?: string;
  PK_BILL_PATH_PREFIX?: string;
};

type CreateSessionPayload = {
  amount: number | string;
  orderId: string;
  clientId: string;
  clientEmail?: string;
  clientPhone?: string;
  serviceName?: string;
};

type TraceError = {
  ok: false;
  error: string;
  traceId: string;
  detail?: string;
};

type TraceSuccess = {
  ok: true;
  data: {
    invoiceId: string;
    paymentUrl: string;
    orderId: string;
    amount: string;
    mock: boolean;
  };
  traceId: string;
};

const DEFAULT_TOKEN_PATH = '/info/settings/token/';
const DEFAULT_CREATE_PATH = '/change/invoice/preview/';
const DEFAULT_BILL_PATH_PREFIX = '/bill';

function json(status: number, body: TraceError | TraceSuccess): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toTraceId(): string {
  return `pk_${crypto.randomUUID()}`;
}

function normalizeBaseUrl(input: string | undefined): string {
  return String(input || '')
    .trim()
    .replace(/\/+$/, '');
}

function normalizePath(input: string | undefined, fallback: string): string {
  const raw = String(input || fallback).trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

function parseAmount(input: number | string): number | null {
  const normalized = typeof input === 'string' ? input.replace(',', '.').trim() : input;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

function validatePayload(payload: Partial<CreateSessionPayload>): string | null {
  if (!payload || typeof payload !== 'object') return 'bad_request';
  if (!payload.orderId || !String(payload.orderId).trim()) return 'missing_order_id';
  if (!payload.clientId || !String(payload.clientId).trim()) return 'missing_client_id';
  if (parseAmount(payload.amount as number | string) === null) return 'invalid_amount';
  return null;
}

async function fetchJson<T>(request: Promise<Response>): Promise<{ ok: true; data: T } | { ok: false; error: string; detail?: string }> {
  let response: Response;
  try {
    response = await request;
  } catch {
    return { ok: false, error: 'paykeeper_unreachable' };
  }

  let data: T | Record<string, unknown>;
  try {
    data = (await response.json()) as T;
  } catch {
    return { ok: false, error: 'paykeeper_bad_json' };
  }

  if (!response.ok) {
    const detail = typeof (data as { msg?: unknown }).msg === 'string' ? String((data as { msg?: unknown }).msg) : undefined;
    return { ok: false, error: 'paykeeper_http_error', detail };
  }

  return { ok: true, data: data as T };
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const traceId = toTraceId();
  const { request, env } = context;
  const guard = await guardMutationRequest(request, env, { scope: 'paykeeper_create_session', maxPerWindow: 15, windowSec: 60 });
  if (!guard.ok) {
    return json(guard.status, { ok: false, error: guard.error, traceId });
  }

  let body: Partial<CreateSessionPayload>;
  try {
    body = (await request.json()) as Partial<CreateSessionPayload>;
  } catch {
    return json(400, { ok: false, error: 'bad_request', traceId });
  }

  const validationError = validatePayload(body);
  if (validationError) {
    return json(400, { ok: false, error: validationError, traceId });
  }

  const amount = parseAmount(body.amount as number | string);
  if (amount === null) {
    return json(400, { ok: false, error: 'invalid_amount', traceId });
  }

  const orderId = String(body.orderId || '').trim();
  const clientId = String(body.clientId || '').trim();
  const clientEmail = String(body.clientEmail || '').trim();
  const clientPhone = String(body.clientPhone || '').trim();
  const serviceName = String(body.serviceName || '').trim() || `Заказ ${orderId}`;

  const serverUrl = normalizeBaseUrl(env.PK_SERVER_URL);
  const isMock = env.PK_MOCK === '1';
  if (!serverUrl && !isMock) {
    return json(500, { ok: false, error: 'not_configured', traceId, detail: 'PK_SERVER_URL is required' });
  }

  // Русский комментарий: для локальной проверки возвращаем детерминированную ссылку без внешнего запроса.
  if (isMock) {
    const invoiceId = `mock-${orderId.toLowerCase()}-${Math.round(amount * 100)}`;
    const paymentUrl = `${serverUrl || 'https://demo.paykeeper.ru'}/bill/${encodeURIComponent(invoiceId)}/`;
    return json(200, {
      ok: true,
      traceId,
      data: {
        invoiceId,
        paymentUrl,
        orderId,
        amount: amount.toFixed(2),
        mock: true,
      },
    });
  }

  const user = String(env.PK_USER || '').trim();
  const password = String(env.PK_PASSWORD || '').trim();
  if (!user || !password) {
    return json(500, { ok: false, error: 'not_configured', traceId, detail: 'PK_USER and PK_PASSWORD are required' });
  }

  const tokenPath = normalizePath(env.PK_TOKEN_PATH, DEFAULT_TOKEN_PATH);
  const createPath = normalizePath(env.PK_CREATE_INVOICE_PATH, DEFAULT_CREATE_PATH);
  const billPathPrefix = normalizePath(env.PK_BILL_PATH_PREFIX, DEFAULT_BILL_PATH_PREFIX);
  const authHeader = `Basic ${btoa(`${user}:${password}`)}`;

  const tokenRes = await fetchJson<{ token?: string }>(
    fetch(`${serverUrl}${tokenPath}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    })
  );

  if (!tokenRes.ok) {
    return json(502, { ok: false, error: tokenRes.error, traceId, detail: tokenRes.detail });
  }

  const token = String(tokenRes.data.token || '').trim();
  if (!token) {
    return json(502, { ok: false, error: 'paykeeper_token_missing', traceId });
  }

  const paymentData = new URLSearchParams();
  paymentData.set('token', token);
  paymentData.set('pay_amount', amount.toFixed(2));
  paymentData.set('orderid', orderId);
  paymentData.set('clientid', clientId);
  paymentData.set('service_name', serviceName);
  if (clientEmail) paymentData.set('client_email', clientEmail);
  if (clientPhone) paymentData.set('client_phone', clientPhone);

  const invoiceRes = await fetchJson<{ invoice_id?: string | number; msg?: string }>(
    fetch(`${serverUrl}${createPath}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: paymentData.toString(),
    })
  );

  if (!invoiceRes.ok) {
    return json(502, { ok: false, error: invoiceRes.error, traceId, detail: invoiceRes.detail });
  }

  const invoiceId = String(invoiceRes.data.invoice_id || '').trim();
  if (!invoiceId) {
    const detail = typeof invoiceRes.data.msg === 'string' ? invoiceRes.data.msg : undefined;
    return json(502, { ok: false, error: 'paykeeper_invoice_missing', traceId, detail });
  }

  const paymentUrl = `${serverUrl}${billPathPrefix}${encodeURIComponent(invoiceId)}/`;

  return json(200, {
    ok: true,
    traceId,
    data: {
      invoiceId,
      paymentUrl,
      orderId,
      amount: amount.toFixed(2),
      mock: false,
    },
  });
};
