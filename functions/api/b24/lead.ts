type Env = {
  B24_WEBHOOK_URL?: string;
  B24_ORIGINATOR_ID?: string;
  B24_CONSULT_DEDUP_MINUTES?: string;
  B24_PRODUCT_MAP_JSON?: string;
  B24_CURRENCY_ID?: string;
  B24_CONTACT_SYNC?: string;
  B24_TELEGRAM_FIELD_CODE?: string;
};

interface ConsultPayload {
  type: 'consult';
  name: string;
  phone: string;
  email: string;
  comment?: string;
  entryPoint?: string;
  sourcePage?: string;
  sourceButton?: string;
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
  entryPoint?: string;
  sourcePage?: string;
  sourceButton?: string;
}

type LeadPayload = ConsultPayload | OrderPayload;

type BitrixApiResponse<T> = {
  result?: T;
  error?: string;
  error_description?: string;
};

type BitrixCallSuccess<T> = { ok: true; data: T };
type BitrixCallError = { ok: false; error: string; detail?: string };
type ProductMap = Record<string, number>;
type BitrixLeadProductRow = {
  PRICE: number;
  QUANTITY: number;
  CURRENCY_ID: string;
  PRODUCT_ID?: number;
  PRODUCT_NAME?: string;
  CUSTOMIZED?: 'Y';
};
type ContactChannels = {
  phoneRaw: string;
  phoneNormalized: string;
  phoneDigits: string;
  email: string;
  telegram: string;
  hasPhone: boolean;
  hasEmail: boolean;
};

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

function isLikelyEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

function normalizeTelegramHandle(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const tMeMatch = raw.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,})/i);
  if (tMeMatch?.[1]) return `@${tMeMatch[1]}`;

  const atMatch = raw.match(/@([a-zA-Z0-9_]{3,})/);
  if (atMatch?.[1]) return `@${atMatch[1]}`;

  if (/^[a-zA-Z0-9_]{3,}$/.test(raw)) return `@${raw}`;
  return '';
}

function splitPersonName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = sanitizeMeta(fullName, 120);
  if (!cleaned) return { firstName: 'Клиент', lastName: '' };
  const parts = cleaned.split(' ').filter(Boolean);
  if (!parts.length) return { firstName: 'Клиент', lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function parseContactChannels(phoneInput: string, emailInput: string): ContactChannels {
  const phoneRaw = sanitizeMeta(phoneInput, 120);
  const phoneNormalized = normalizePhone(phoneRaw);
  const phoneDigits = phoneNormalized.replace(/\D/g, '');
  const hasPhone = phoneDigits.length >= 10;

  const emailNormalized = normalizeEmail(emailInput);
  const hasEmail = isLikelyEmail(emailNormalized);
  const telegram = hasPhone ? '' : normalizeTelegramHandle(phoneRaw);

  return {
    phoneRaw,
    phoneNormalized,
    phoneDigits,
    email: hasEmail ? emailNormalized : '',
    telegram,
    hasPhone,
    hasEmail,
  };
}

function sanitizeMeta(input: string | undefined, maxLength: number): string {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeSku(input: string | undefined): string {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 60);
}

function normalizeColor(input: string | undefined): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()"'`]/g, '')
    .replace(/[^a-z0-9а-я]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function colorAliases(normalizedColor: string): string[] {
  if (!normalizedColor) return [];
  const aliases = new Set<string>([normalizedColor]);

  if (normalizedColor.includes('черн') || normalizedColor === 'black') {
    aliases.add('черный');
    aliases.add('black');
  }
  if (normalizedColor.includes('сереб') || normalizedColor === 'silver') {
    aliases.add('серебристый');
    aliases.add('silver');
  }
  if (
    normalizedColor.includes('золот') ||
    normalizedColor === 'gold' ||
    normalizedColor === 'starlight'
  ) {
    aliases.add('золотистый');
    aliases.add('gold');
    aliases.add('starlight');
  }
  if (normalizedColor.includes('син') || normalizedColor === 'blue') {
    aliases.add('синий');
    aliases.add('blue');
  }
  if (
    normalizedColor.includes('графит') ||
    normalizedColor.includes('gray') ||
    normalizedColor.includes('grey') ||
    normalizedColor === 'graphite' ||
    normalizedColor === 'cosmic_gray'
  ) {
    aliases.add('графит');
    aliases.add('gray');
    aliases.add('cosmic_gray');
    aliases.add('graphite');
  }
  if (
    normalizedColor.includes('фиолет') ||
    normalizedColor === 'purple' ||
    normalizedColor === 'violet'
  ) {
    aliases.add('фиолетовый');
    aliases.add('purple');
    aliases.add('violet');
  }

  return Array.from(aliases);
}

function parseProductMap(rawJson: string | undefined): ProductMap {
  if (!rawJson || !rawJson.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: ProductMap = {};
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(rawKey || '').trim();
    const value = Number(rawValue);
    if (!key || !Number.isFinite(value) || value <= 0) continue;

    if (key.includes('::')) {
      const [skuPart, colorPart] = key.split('::');
      const sku = normalizeSku(skuPart);
      const color = normalizeColor(colorPart);
      if (!sku || !color) continue;
      out[`${sku}::${color}`] = Math.floor(value);
      continue;
    }

    const sku = normalizeSku(key);
    if (!sku) continue;
    out[sku] = Math.floor(value);
  }

  return out;
}

function resolveProductId(item: OrderItem, productMap: ProductMap): number | null {
  const sku = normalizeSku(item.sku);
  if (!sku) return null;
  const color = normalizeColor(item.color);

  if (color) {
    for (const colorKey of colorAliases(color)) {
      const fromSkuColor = productMap[`${sku}::${colorKey}`];
      if (Number.isFinite(fromSkuColor) && fromSkuColor > 0) return fromSkuColor;
    }
  }

  const fromSku = productMap[sku];
  if (Number.isFinite(fromSku) && fromSku > 0) return fromSku;
  return null;
}

function parseAmount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const normalized = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function buildProductRowName(item: OrderItem): string {
  const name = sanitizeMeta(item.name, 140) || 'Товар';
  const color = sanitizeMeta(item.color, 60);
  const sku = normalizeSku(item.sku);
  const withColor = color ? `${name} (${color})` : name;
  return sku ? `${withColor} [${sku}]` : withColor;
}

function calculateOrderTotal(items: OrderItem[] | undefined, totalRaw: string | undefined): number {
  const fromItems = Array.isArray(items)
    ? items.reduce((sum, item) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      const price = parseAmount(item.price);
      return sum + qty * price;
    }, 0)
    : 0;

  if (fromItems > 0) return Number(fromItems.toFixed(2));
  return Number(parseAmount(totalRaw).toFixed(2));
}

function buildProductRows(
  items: OrderItem[] | undefined,
  productMap: ProductMap,
  currencyId: string
): { rows: BitrixLeadProductRow[]; unmappedItems: number } {
  if (!Array.isArray(items) || !items.length) return { rows: [], unmappedItems: 0 };

  const grouped = new Map<string, BitrixLeadProductRow>();
  let unmappedItems = 0;

  for (const item of items) {
    const qty = Math.max(1, Number(item.qty) || 1);
    const price = parseAmount(item.price);
    const productId = resolveProductId(item, productMap);

    const key = productId
      ? `id:${productId}:${price.toFixed(2)}`
      : `name:${buildProductRowName(item)}:${price.toFixed(2)}`;
    const prev = grouped.get(key);

    if (prev) {
      prev.QUANTITY += qty;
      continue;
    }

    if (productId) {
      grouped.set(key, {
        PRODUCT_ID: productId,
        PRICE: price,
        QUANTITY: qty,
        CURRENCY_ID: currencyId,
      });
      continue;
    }

    // Русский комментарий: fallback-строка без PRODUCT_ID, чтобы товар и сумма не терялись в лиде.
    unmappedItems += 1;
    grouped.set(key, {
      PRODUCT_NAME: buildProductRowName(item),
      PRICE: price,
      QUANTITY: qty,
      CURRENCY_ID: currencyId,
      CUSTOMIZED: 'Y',
    });
  }

  return { rows: Array.from(grouped.values()), unmappedItems };
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

async function findContactByPhone(webhookUrl: string, phone: string): Promise<number | null> {
  const variants = Array.from(
    new Set(
      [phone, normalizePhone(phone), normalizePhone(phone).replace(/\D/g, '')]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  for (const candidate of variants) {
    const res = await callBitrix<Array<{ ID?: string | number }>>(webhookUrl, 'crm.contact.list', {
      filter: { PHONE: candidate },
      order: { ID: 'DESC' },
      select: ['ID'],
    });
    if (res.ok === false) continue;

    const idRaw = res.data?.[0]?.ID;
    const id = idRaw !== undefined && idRaw !== null ? Number(idRaw) : NaN;
    if (isFinite(id) && id > 0) return id;
  }

  return null;
}

async function findContactByEmail(webhookUrl: string, email: string): Promise<number | null> {
  const normalized = normalizeEmail(email);
  if (!normalized || !isLikelyEmail(normalized)) return null;

  const res = await callBitrix<Array<{ ID?: string | number }>>(webhookUrl, 'crm.contact.list', {
    filter: { EMAIL: normalized },
    order: { ID: 'DESC' },
    select: ['ID'],
  });
  if (res.ok === false) return null;

  const idRaw = res.data?.[0]?.ID;
  const id = idRaw !== undefined && idRaw !== null ? Number(idRaw) : NaN;
  return isFinite(id) && id > 0 ? id : null;
}

async function findOrCreateContact(
  webhookUrl: string,
  payload: LeadPayload,
  channels: ContactChannels,
  entryPoint: string,
  sourcePage: string,
  sourceButton: string,
  env: Env
): Promise<{ id: number | null; warning?: string }> {
  if (env.B24_CONTACT_SYNC === '0') return { id: null };

  if (channels.hasPhone) {
    const existingByPhone = await findContactByPhone(webhookUrl, channels.phoneRaw);
    if (existingByPhone) return { id: existingByPhone };
  }
  if (channels.hasEmail) {
    const existingByEmail = await findContactByEmail(webhookUrl, channels.email);
    if (existingByEmail) return { id: existingByEmail };
  }

  if (!channels.hasPhone && !channels.hasEmail && !channels.telegram) {
    return { id: null, warning: 'contact_sync_skipped_no_channels' };
  }

  const personName = splitPersonName(payload.name);
  const telegramFieldCode = sanitizeMeta(env.B24_TELEGRAM_FIELD_CODE, 80);

  const contactComments = [
    'Источник лида с сайта:',
    `Точка входа: ${entryPoint}`,
    sourcePage ? `Страница: ${sourcePage}` : '',
    sourceButton ? `Кнопка: ${sourceButton}` : '',
    channels.telegram ? `Telegram: ${channels.telegram}` : '',
  ].filter(Boolean).join('\n');

  const fields: Record<string, unknown> = {
    NAME: personName.firstName,
    ...(personName.lastName ? { LAST_NAME: personName.lastName } : {}),
    TYPE_ID: 'CLIENT',
    SOURCE_ID: 'WEB',
    COMMENTS: contactComments,
  };

  if (channels.hasPhone) {
    fields.PHONE = [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }];
  }
  if (channels.hasEmail) {
    fields.EMAIL = [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }];
  }
  if (channels.telegram) {
    if (telegramFieldCode) {
      // Русский комментарий: пишем Telegram в кастомное поле контакта только если код поля задан в env.
      fields[telegramFieldCode] = channels.telegram;
    } else {
      fields.COMMENTS = `${contactComments}\n(Подсказка: задайте B24_TELEGRAM_FIELD_CODE, чтобы хранить Telegram в отдельном поле.)`;
    }
  }

  const addRes = await callBitrix<number>(webhookUrl, 'crm.contact.add', { fields });
  if (addRes.ok === false) {
    return { id: null, warning: `contact_add_failed:${addRes.error}` };
  }
  return { id: addRes.data };
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
  const orderIdNormalized = isOrder && o ? sanitizeMeta(o.orderId, 80) : '';
  const consultDedupMinutes = parsePositiveInt(env.B24_CONSULT_DEDUP_MINUTES, DEFAULT_CONSULT_DEDUP_MINUTES);
  const originatorId = (env.B24_ORIGINATOR_ID || DEFAULT_ORIGINATOR_ID).trim() || DEFAULT_ORIGINATOR_ID;
  const channels = parseContactChannels(phone, email);
  const productMap = parseProductMap(env.B24_PRODUCT_MAP_JSON);
  const currencyId = sanitizeMeta(env.B24_CURRENCY_ID || 'RUB', 6) || 'RUB';
  const consultComment = !isOrder ? String((body as ConsultPayload).comment || '').trim() : '';
  const rawEntryPoint = sanitizeMeta((body as ConsultPayload | OrderPayload).entryPoint, 80);
  const sourcePage = sanitizeMeta((body as ConsultPayload | OrderPayload).sourcePage, 120);
  const sourceButton = sanitizeMeta((body as ConsultPayload | OrderPayload).sourceButton, 120);
  const entryPoint = rawEntryPoint || (isOrder ? 'cart_checkout_default' : 'consult_default');
  const warnings: string[] = [];

  if (isOrder && o) {
    if (!orderIdNormalized) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_order_id' }), { status: 400, headers });
    }
    if (!Array.isArray(o.items) || o.items.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_order_items' }), { status: 400, headers });
    }
    if (!channels.hasPhone) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_order_phone' }), { status: 400, headers });
    }
  }

  const contactSync = await findOrCreateContact(webhookUrl, body, channels, entryPoint, sourcePage, sourceButton, env);
  const contactId = contactSync.id;
  if (contactSync.warning) warnings.push(contactSync.warning);

  const title = isOrder && o
    ? `Заказ ${orderIdNormalized || o.orderId} — ${name}`
    : `Консультация по диктофонам — ${name}`;

  const sourceLines = [
    `Точка входа: ${entryPoint}`,
    sourcePage ? `Страница: ${sourcePage}` : '',
    sourceButton ? `Кнопка: ${sourceButton}` : '',
    channels.telegram ? `Telegram: ${channels.telegram}` : '',
  ].filter(Boolean);

  const businessLines = isOrder && o
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
      ]
    : (consultComment ? [`Комментарий клиента: ${consultComment}`] : []);

  const comments = [...sourceLines, ...(businessLines.length ? ['', ...businessLines] : [])]
    .filter((line, index, arr) => !(line === '' && (index === 0 || arr[index - 1] === '')))
    .join('\n');

  // Ключ идемпотентности: для заказа — номер заказа, для консультации — отпечаток контакта в окне времени.
  const consultBucket = Math.floor(Date.now() / (consultDedupMinutes * 60 * 1000));
  const dedupeOriginId = isOrder && o
    ? `order:${String(orderIdNormalized || '').trim().toUpperCase()}:${entryPoint}`
    : `consult:${consultBucket}:${hashString([channels.phoneNormalized, channels.email, channels.telegram, consultComment, entryPoint, sourcePage, sourceButton].join('|'))}`;

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
    if (isOrder && o) {
      const orderTotal = calculateOrderTotal(o.items, o.total);
      const updateRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.update', {
        id: existingId,
        fields: {
          OPPORTUNITY: orderTotal,
          CURRENCY_ID: currencyId,
          ...(comments ? { COMMENTS: comments } : {}),
        },
      });
      if (updateRes.ok === false) warnings.push(`lead_order_update_failed:${updateRes.error}`);

      const { rows, unmappedItems } = buildProductRows(o.items, productMap, currencyId);
      if (unmappedItems > 0) warnings.push(`productrows_unmapped_items:${unmappedItems}`);
      if (rows.length) {
        const setRowsRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.productrows.set', {
          id: existingId,
          rows,
        });
        if (setRowsRes.ok === false) warnings.push(`productrows_set_failed:${setRowsRes.error}`);
      } else {
        warnings.push('productrows_not_mapped');
      }
    }

    if (!isOrder && contactId) {
      const linkRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.update', {
        id: existingId,
        fields: { CONTACT_ID: contactId },
      });
      if (linkRes.ok === false) warnings.push(`lead_contact_link_failed:${linkRes.error}`);
    }
    return new Response(JSON.stringify({ ok: true, id: existingId, duplicate: true, ...(warnings.length ? { warnings } : {}) }), {
      headers,
    });
  }

  const fields: Record<string, unknown> = {
    TITLE: title,
    NAME: name,
    SOURCE_ID: 'WEB',
    // Русский комментарий: сохраняем точку входа, чтобы в CRM различать каждую кнопку/форму.
    SOURCE_DESCRIPTION: `${isOrder ? 'Корзина' : 'Консультация по диктофонам'} | ${entryPoint}`,
    ORIGINATOR_ID: originatorId,
    ORIGIN_ID: dedupeOriginId,
  };
  if (isOrder && o) {
    const orderTotal = calculateOrderTotal(o.items, o.total);
    // Русский комментарий: заполняем сумму лида явно, чтобы в Bitrix не оставался 0.
    fields.OPPORTUNITY = orderTotal;
    fields.CURRENCY_ID = currencyId;
    if (orderTotal <= 0) warnings.push('order_total_zero');
  }
  if (channels.hasPhone) fields.PHONE = [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }];
  if (channels.hasEmail) fields.EMAIL = [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }];
  if (contactId) fields.CONTACT_ID = contactId;
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

  if (isOrder && o) {
    const { rows, unmappedItems } = buildProductRows(o.items, productMap, currencyId);
    if (unmappedItems > 0) warnings.push(`productrows_unmapped_items:${unmappedItems}`);
    if (rows.length) {
      // Русский комментарий: добавляем товарные позиции в лид Bitrix, чтобы менеджер видел корзину в блоке "Товары".
      const setRowsRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.productrows.set', {
        id: createLeadRes.data,
        rows,
      });
      if (setRowsRes.ok === false) {
        warnings.push(`productrows_set_failed:${setRowsRes.error}`);
      }
    } else {
      warnings.push('productrows_not_mapped');
    }
  }

  return new Response(JSON.stringify({ ok: true, id: createLeadRes.data, ...(warnings.length ? { warnings } : {}) }), {
    headers,
  });
};
