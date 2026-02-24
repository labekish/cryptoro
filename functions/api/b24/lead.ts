type Env = {
  B24_WEBHOOK_URL?: string;
};

interface ConsultPayload {
  type: 'consult';
  name: string;
  phone: string;
  email: string;
}

interface OrderPayload {
  type: 'order';
  name: string;
  phone: string;
  email: string;
  city: string;
  street: string;
  zip: string;
  delivery: string;
  cart: string;
  total: string;
}

type LeadPayload = ConsultPayload | OrderPayload;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
  if (!name || !phone) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), { status: 400, headers });
  }

  const isOrder = type === 'order';
  const o = isOrder ? (body as OrderPayload) : null;

  const title = isOrder
    ? `Заказ с сайта — ${name}`
    : `Консультация по диктофонам — ${name}`;

  const comments = isOrder && o
    ? [
        `Доставка: ${o.delivery || '—'}`,
        `Адрес: ${[o.city, o.street, o.zip].filter(Boolean).join(', ') || '—'}`,
        '',
        'Состав заказа:',
        o.cart || '—',
        '',
        `Итого: ${o.total || '—'}`,
      ].join('\n')
    : undefined;

  const fields: Record<string, unknown> = {
    TITLE: title,
    NAME: name,
    PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
    EMAIL: email ? [{ VALUE: email, VALUE_TYPE: 'WORK' }] : undefined,
    SOURCE_ID: 'WEB',
    SOURCE_DESCRIPTION: isOrder ? 'Корзина' : 'Консультация по диктофонам',
    CATEGORY_ID: 0,
  };
  if (comments) fields.COMMENTS = comments;

  const b24Res = await fetch(`${webhookUrl}/crm.lead.add.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, params: {} }),
  });

  if (!b24Res.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'b24_error' }), { status: 502, headers });
  }

  const data: { result?: number } = await b24Res.json();
  return new Response(JSON.stringify({ ok: true, id: data.result }), { headers });
};
