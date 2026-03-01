type Env = {
  B24_WEBHOOK_URL?: string;
  B24_ORIGINATOR_ID?: string;
  B24_CONSULT_DEDUP_MINUTES?: string;
};

interface ConsultPayload {
  type: 'consult';
  name: string;
  phone: string;
  email: string;
  comment?: string;
}

interface OrderItem {
  sku?: string;
  name: string;
  qty: number;
  price: number;
  color?: string;
}

interface OrderPayload {
  type: 'order';
  orderId: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  street: string;
  apartment?: string;
  zip: string;
  delivery: string;
  items: OrderItem[];
  total: string;
}

type LeadPayload = ConsultPayload | OrderPayload;

type BitrixApiResponse<T> = {
  result?: T;
  error?: string;
  error_description?: string;
};

type BitrixCallSuccess<T> = { ok: true; data: T };
type BitrixCallError = { ok: false; error: string; detail?: string };

const DEFAULT_ORIGINATOR_ID = 'CRYPTORO_SITE';
const DEFAULT_CONSULT_DEDUP_MINUTES = 30;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizePhone(input: string): string {
  return String(input || '')
    .trim()
    .replace(/[^\d+]/g, '');
}

function normalizeEmail(input: string): string {
  return String(input || '').trim().toLowerCase();
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function callBitrix<T>(
  webhookUrl: string,
  method: string,
  payload: Record<string, unknown>
): Promise<BitrixCallSuccess<T> | BitrixCallError> {
  let response: Response;
  try {
    response = await fetch(`${webhookUrl}/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'b24_unreachable' };
  }

  let data: BitrixApiResponse<T>;
  try {
    data = (await response.json()) as BitrixApiResponse<T>;
  } catch {
    return { ok: false, error: 'b24_bad_response' };
  }

  if (!response.ok || data.error) {
    return {
      ok: false,
      error: data.error || 'b24_error',
      detail: data.error_description,
    };
  }

  return { ok: true, data: data.result as T };
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json' };

  const webhookUrl = (env.B24_WEBHOOK_URL || '').trim().replace(/\/$/, '');
  if (!webhookUrl) {
    return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), { status: 500, headers });
  }

  let body: LeadPayload;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 400, headers });
  }

  const { type, name, phone, email } = body;
  if (!name || !phone || (type !== 'consult' && type !== 'order')) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), { status: 400, headers });
  }

  const isOrder = type === 'order';
  const o = isOrder ? (body as OrderPayload) : null;
  const consultDedupMinutes = parsePositiveInt(env.B24_CONSULT_DEDUP_MINUTES, DEFAULT_CONSULT_DEDUP_MINUTES);
  const originatorId = (env.B24_ORIGINATOR_ID || DEFAULT_ORIGINATOR_ID).trim() || DEFAULT_ORIGINATOR_ID;
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const consultComment = !isOrder ? String((body as ConsultPayload).comment || '').trim() : '';

  const title = isOrder && o
    ? `Заказ ${o.orderId} — ${name}`
    : `Консультация по диктофонам — ${name}`;

  const comments = isOrder && o
    ? [
        `№ заказа: ${o.orderId || '—'}`,
        `Доставка: ${o.delivery || '—'}`,
        `Адрес: ${[o.city, o.street, o.apartment, o.zip].filter(Boolean).join(', ') || '—'}`,
        '',
        'Состав заказа:',
        ...(o.items?.length
          ? o.items.map((item) => {
              const label = item.color ? `${item.name} (${item.color})` : item.name;
              const sku = item.sku ? ` [${item.sku}]` : '';
              return `${label}${sku} x${item.qty} — ${item.price} ₽`;
            })
          : ['—']),
        '',
        `Итого: ${o.total || '—'}`,
      ].join('\n')
    : (consultComment ? `Комментарий клиента:\n${consultComment}` : undefined);

  // Ключ идемпотентности: для заказа — номер заказа, для консультации — отпечаток контакта в окне времени.
  const consultBucket = Math.floor(Date.now() / (consultDedupMinutes * 60 * 1000));
  const dedupeOriginId = isOrder && o
    ? `order:${String(o.orderId || '').trim().toUpperCase()}`
    : `consult:${consultBucket}:${hashString([normalizedPhone, normalizedEmail, consultComment].join('|'))}`;

  // Если лид с таким ключом уже есть, возвращаем существующий ID и не создаем дубль.
  const existingLeadRes = await callBitrix<Array<{ ID?: string | number }>>(webhookUrl, 'crm.lead.list', {
    filter: {
      ORIGINATOR_ID: originatorId,
      ORIGIN_ID: dedupeOriginId,
    },
    order: { ID: 'DESC' },
    select: ['ID'],
  });

  if (existingLeadRes.ok === false) {
    return new Response(JSON.stringify({ ok: false, error: existingLeadRes.error, detail: existingLeadRes.detail }), {
      status: 502,
      headers,
    });
  }

  const existingIdRaw = existingLeadRes.data?.[0]?.ID;
  const existingId = existingIdRaw !== undefined && existingIdRaw !== null ? Number(existingIdRaw) : NaN;
  if (isFinite(existingId) && existingId > 0) {
    return new Response(JSON.stringify({ ok: true, id: existingId, duplicate: true }), { headers });
  }

  const fields: Record<string, unknown> = {
    TITLE: title,
    NAME: name,
    PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
    SOURCE_ID: 'WEB',
    SOURCE_DESCRIPTION: isOrder ? 'Корзина' : 'Консультация по диктофонам',
    ORIGINATOR_ID: originatorId,
    ORIGIN_ID: dedupeOriginId,
  };
  if (email) fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'WORK' }];
  if (comments) fields.COMMENTS = comments;

  const createLeadRes = await callBitrix<number>(webhookUrl, 'crm.lead.add', {
    fields,
  });

  if (createLeadRes.ok === false) {
    return new Response(
      JSON.stringify({ ok: false, error: createLeadRes.error, detail: createLeadRes.detail }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ ok: true, id: createLeadRes.data }), { headers });
};
