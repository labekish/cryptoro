type Env = {
  B24_WEBHOOK_URL?: string;
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
  if (!name || !phone) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), { status: 400, headers });
  }

  const isOrder = type === 'order';
  const o = isOrder ? (body as OrderPayload) : null;
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

  const fields: Record<string, unknown> = {
    TITLE: title,
    NAME: name,
    PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
    SOURCE_ID: 'WEB',
    SOURCE_DESCRIPTION: isOrder ? 'Корзина' : 'Консультация по диктофонам',
  };
  if (email) fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'WORK' }];
  if (comments) fields.COMMENTS = comments;

  const b24Res = await fetch(`${webhookUrl}/crm.lead.add.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  const data: { result?: number; error?: string; error_description?: string } = await b24Res.json();

  if (!b24Res.ok || data.error) {
    return new Response(
      JSON.stringify({ ok: false, error: data.error || 'b24_error', detail: data.error_description }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ ok: true, id: data.result }), { headers });
};
