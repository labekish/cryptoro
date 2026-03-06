import { createCdekOrder, type CdekCreateOrderPayload, type CdekCreateOrderResult } from '../cdek/create-order';

type Env = {
  B24_WEBHOOK_URL?: string;
  B24_ORIGINATOR_ID?: string;
  B24_CONSULT_DEDUP_MINUTES?: string;
  B24_AUTO_FIELD_DISCOVERY?: string;
  B24_LEAD_SOURCE_ID?: string;
  B24_CONTACT_SOURCE_ID?: string;
  B24_PRODUCT_MAP_JSON?: string;
  B24_CURRENCY_ID?: string;
  B24_CONTACT_SYNC?: string;
  B24_CONTACT_UPDATE_ON_MATCH?: string;
  B24_TELEGRAM_FIELD_CODE?: string;
  B24_LEAD_DELIVERY_FIELD_CODE?: string;
  B24_LEAD_DELIVERY_ENUM_JSON?: string;
  B24_LEAD_FULL_NAME_FIELD_CODE?: string;
  B24_LEAD_PHONE_FIELD_CODE?: string;
  B24_LEAD_EMAIL_FIELD_CODE?: string;
  B24_DEAL_DELIVERY_FIELD_CODE?: string;
  B24_DEAL_DELIVERY_ENUM_JSON?: string;
  B24_DEAL_FULL_NAME_FIELD_CODE?: string;
  B24_DEAL_PHONE_FIELD_CODE?: string;
  B24_DEAL_EMAIL_FIELD_CODE?: string;
  B24_DEAL_SYNC_ON_CONVERT?: string;
  B24_LEAD_DELIVERY_COST_FIELD_CODE?: string;
  B24_DEAL_DELIVERY_COST_FIELD_CODE?: string;
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
  deliveryType?: 'pickup' | 'door';
  deliveryTariffCode?: number;
  deliveryCost?: number;
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
  PRODUCT_ID?: number;
  PRODUCT_NAME?: string;
  CUSTOMIZED?: 'Y';
};
type LeadVerifyInfo = {
  opportunity: string;
  currencyId: string;
  productRowsCount: number;
};
type ProductRowsSyncResult =
  | { ok: true; method?: string }
  | { ok: false; warning: string };
type EnumMap = Record<string, string | number>;
type ContactChannels = {
  phoneRaw: string;
  phoneNormalized: string;
  phoneDigits: string;
  email: string;
  telegram: string;
  hasPhone: boolean;
  hasEmail: boolean;
};
type BitrixFieldDefinition = {
  type?: string;
  title?: string;
  formLabel?: string;
  listLabel?: string;
  items?: unknown;
};
type BitrixFieldMap = Record<string, BitrixFieldDefinition>;
type ResolvedCrmFieldConfig = {
  deliveryFieldCode: string;
  deliveryEnumMap: EnumMap;
  deliveryFieldRequiresEnum: boolean;
  fullNameFieldCode: string;
  phoneFieldCode: string;
  emailFieldCode: string;
  deliveryCostFieldCode: string;
};

const DEFAULT_ORIGINATOR_ID = 'CRYPTORO_SITE';
const DEFAULT_CONSULT_DEDUP_MINUTES = 30;
const EMPTY_CRM_FIELD_CONFIG: ResolvedCrmFieldConfig = {
  deliveryFieldCode: '',
  deliveryEnumMap: {},
  deliveryFieldRequiresEnum: false,
  fullNameFieldCode: '',
  phoneFieldCode: '',
  emailFieldCode: '',
  deliveryCostFieldCode: '',
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseB24SourceId(value: string | undefined): string {
  return sanitizeMeta(value, 40).toUpperCase();
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

function formatRub(value: number): string {
  const rounded = Math.round(Number(value || 0));
  return `${new Intl.NumberFormat('ru-RU').format(Math.max(0, rounded))} ₽`;
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

function calculateOrderOpportunity(
  items: OrderItem[] | undefined,
  totalRaw: string | undefined,
  deliveryCostRaw: unknown
): number {
  const itemsTotal = calculateOrderTotal(items, totalRaw);
  const deliveryCost = parseAmount(deliveryCostRaw);
  return Number((itemsTotal + deliveryCost).toFixed(2));
}

function buildProductRows(
  items: OrderItem[] | undefined,
  productMap: ProductMap
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
        PRODUCT_NAME: buildProductRowName(item),
        PRICE: price,
        QUANTITY: qty,
      });
      continue;
    }

    // Русский комментарий: fallback-строка без PRODUCT_ID, чтобы товар и сумма не терялись в лиде.
    unmappedItems += 1;
    grouped.set(key, {
      PRODUCT_NAME: buildProductRowName(item),
      PRICE: price,
      QUANTITY: qty,
    });
  }

  return { rows: Array.from(grouped.values()), unmappedItems };
}

function mapRowsToItemApi(rows: BitrixLeadProductRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    productId: row.PRODUCT_ID,
    productName: row.PRODUCT_NAME,
    price: row.PRICE,
    quantity: row.QUANTITY,
    customized: row.CUSTOMIZED,
  }));
}

function toCustomRows(rows: BitrixLeadProductRow[]): BitrixLeadProductRow[] {
  return rows.map((row) => ({
    PRODUCT_NAME: row.PRODUCT_NAME || 'Товар',
    PRICE: row.PRICE,
    QUANTITY: row.QUANTITY,
    CUSTOMIZED: 'Y',
  }));
}

function formatBitrixError(label: string, res: BitrixCallError | BitrixCallSuccess<boolean>): string {
  if (res.ok === false) {
    const detail = sanitizeMeta(res.detail, 160);
    return `${label}:${res.error}${detail ? `(${detail})` : ''}`;
  }
  return `${label}:ok`;
}

function shouldSyncDealOnConvert(env: Env): boolean {
  return String(env.B24_DEAL_SYNC_ON_CONVERT || '1').trim() !== '0';
}

function shouldUpdateContactOnMatch(env: Env): boolean {
  return String(env.B24_CONTACT_UPDATE_ON_MATCH || '1').trim() !== '0';
}

function shouldAutoFieldDiscovery(env: Env): boolean {
  return String(env.B24_AUTO_FIELD_DISCOVERY || '1').trim() !== '0';
}

function normalizeFieldLabel(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()"'`.,:;/\\[\]{}|!?+_*&#№-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function collectFieldLabels(field: BitrixFieldDefinition): string[] {
  return [field.title, field.formLabel, field.listLabel]
    .map((value) => normalizeFieldLabel(String(value || '')))
    .filter(Boolean);
}

function isUserFieldCode(fieldCode: string): boolean {
  return fieldCode.startsWith('UF_CRM_');
}

function findFieldCodeByAliases(
  fields: BitrixFieldMap,
  aliases: string[],
  negativeAliases: string[] = []
): { code: string; field?: BitrixFieldDefinition } {
  const normalizedAliases = aliases.map((alias) => normalizeFieldLabel(alias)).filter(Boolean);
  const normalizedNegativeAliases = negativeAliases
    .map((alias) => normalizeFieldLabel(alias))
    .filter(Boolean);

  let bestScore = 0;
  let bestCode = '';
  let bestField: BitrixFieldDefinition | undefined;

  for (const [fieldCode, field] of Object.entries(fields || {})) {
    const labels = collectFieldLabels(field);
    if (!labels.length) continue;

    const hasNegative = labels.some((label) =>
      normalizedNegativeAliases.some((negative) => negative && label.includes(negative))
    );
    if (hasNegative) continue;

    let score = 0;
    for (const label of labels) {
      for (const alias of normalizedAliases) {
        if (!alias) continue;
        if (label === alias) score = Math.max(score, 120);
        else if (label.startsWith(alias)) score = Math.max(score, 100);
        else if (label.includes(alias)) score = Math.max(score, 80);
      }
    }

    if (score <= 0) continue;
    if (isUserFieldCode(fieldCode)) score += 10;
    if (score <= bestScore) continue;

    bestScore = score;
    bestCode = fieldCode;
    bestField = field;
  }

  return bestCode ? { code: bestCode, field: bestField } : { code: '' };
}

function isListLikeField(field: BitrixFieldDefinition | undefined): boolean {
  const type = normalizeFieldLabel(String(field?.type || ''));
  return type === 'enumeration' || type === 'list' || type === 'crm status' || type === 'crm_status';
}

function buildEnumMapFromFieldItems(field: BitrixFieldDefinition | undefined): EnumMap {
  if (!field?.items) return {};

  const sourceItems = Array.isArray(field.items)
    ? field.items
    : typeof field.items === 'object' && field.items
      ? Object.values(field.items as Record<string, unknown>)
      : [];

  const enumMap: EnumMap = {};
  for (const rawItem of sourceItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const value = sanitizeMeta(String(item.VALUE ?? item.value ?? item.NAME ?? item.name ?? ''), 120);
    const idCandidate = item.ID ?? item.id ?? item.VALUE_ID ?? item.valueId;
    const idNum = Number(idCandidate);
    const id = Number.isFinite(idNum) && idNum > 0 ? idNum : sanitizeMeta(String(idCandidate ?? ''), 80);
    if (!value || !id) continue;
    enumMap[value] = id;
  }
  return enumMap;
}

async function getCrmFieldMap(
  webhookUrl: string,
  entity: 'lead' | 'deal'
): Promise<BitrixFieldMap | null> {
  const method = entity === 'deal' ? 'crm.deal.fields' : 'crm.lead.fields';
  const res = await callBitrix<BitrixFieldMap>(webhookUrl, method, {});
  if (res.ok === false) return null;
  return res.data && typeof res.data === 'object' ? res.data : null;
}

async function resolveCrmFieldConfig(
  webhookUrl: string,
  entity: 'lead' | 'deal',
  env: Env,
  warnings: string[]
): Promise<ResolvedCrmFieldConfig> {
  const isLead = entity === 'lead';
  const config: ResolvedCrmFieldConfig = {
    deliveryFieldCode: sanitizeMeta(
      isLead ? env.B24_LEAD_DELIVERY_FIELD_CODE : env.B24_DEAL_DELIVERY_FIELD_CODE,
      80
    ),
    deliveryEnumMap: parseEnumMap(
      isLead ? env.B24_LEAD_DELIVERY_ENUM_JSON : env.B24_DEAL_DELIVERY_ENUM_JSON
    ),
    deliveryFieldRequiresEnum: false,
    fullNameFieldCode: sanitizeMeta(
      isLead ? env.B24_LEAD_FULL_NAME_FIELD_CODE : env.B24_DEAL_FULL_NAME_FIELD_CODE,
      80
    ),
    phoneFieldCode: sanitizeMeta(
      isLead ? env.B24_LEAD_PHONE_FIELD_CODE : env.B24_DEAL_PHONE_FIELD_CODE,
      80
    ),
    emailFieldCode: sanitizeMeta(
      isLead ? env.B24_LEAD_EMAIL_FIELD_CODE : env.B24_DEAL_EMAIL_FIELD_CODE,
      80
    ),
    deliveryCostFieldCode: sanitizeMeta(
      isLead ? env.B24_LEAD_DELIVERY_COST_FIELD_CODE : env.B24_DEAL_DELIVERY_COST_FIELD_CODE,
      80
    ),
  };

  if (!shouldAutoFieldDiscovery(env)) return config;

  const needFieldDiscovery = !config.deliveryFieldCode
    || !config.fullNameFieldCode
    || !config.phoneFieldCode
    || !config.emailFieldCode
    || !config.deliveryCostFieldCode
    || (!Object.keys(config.deliveryEnumMap).length && !!config.deliveryFieldCode);
  if (!needFieldDiscovery) return config;

  const fieldMap = await getCrmFieldMap(webhookUrl, entity);
  if (!fieldMap) {
    warnings.push(`${entity}_fields_autodetect_failed`);
    return config;
  }

  if (!config.fullNameFieldCode) {
    const found = findFieldCodeByAliases(fieldMap, ['ФИО', 'имя и фамилия', 'полное имя']);
    if (found.code) config.fullNameFieldCode = found.code;
  }

  if (!config.phoneFieldCode) {
    const found = findFieldCodeByAliases(fieldMap, ['телефон', 'phone']);
    if (found.code) config.phoneFieldCode = found.code;
  }

  if (!config.emailFieldCode) {
    const found = findFieldCodeByAliases(fieldMap, ['e-mail', 'email', 'электронная почта']);
    if (found.code) config.emailFieldCode = found.code;
  }

  let deliveryFieldMeta: BitrixFieldDefinition | undefined;
  if (!config.deliveryFieldCode) {
    const found = findFieldCodeByAliases(
      fieldMap,
      ['способ доставки', 'доставка'],
      ['стоимость', 'трек', 'статус', 'отгружен', 'разрешена', 'код']
    );
    if (found.code) {
      config.deliveryFieldCode = found.code;
      deliveryFieldMeta = found.field;
    }
  } else {
    deliveryFieldMeta = fieldMap[config.deliveryFieldCode];
  }

  if (!config.deliveryCostFieldCode) {
    const found = findFieldCodeByAliases(
      fieldMap,
      ['стоимость доставки', 'расчетная стоимость доставки'],
      ['сдэк']
    );
    if (found.code) config.deliveryCostFieldCode = found.code;
  }

  if (config.deliveryFieldCode && !deliveryFieldMeta) {
    deliveryFieldMeta = fieldMap[config.deliveryFieldCode];
  }
  config.deliveryFieldRequiresEnum = isListLikeField(deliveryFieldMeta);

  if (
    config.deliveryFieldCode
    && config.deliveryFieldRequiresEnum
    && !Object.keys(config.deliveryEnumMap).length
  ) {
    // Русский комментарий: если список значений в env не задан, пытаемся собрать enum напрямую из метаданных Б24.
    config.deliveryEnumMap = buildEnumMapFromFieldItems(deliveryFieldMeta);
  }

  if (
    config.deliveryFieldCode
    && config.deliveryFieldRequiresEnum
    && !Object.keys(config.deliveryEnumMap).length
  ) {
    warnings.push(`${entity}_delivery_enum_missing`);
  }

  return config;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDeliveryLabel(input: string): string {
  return String(input || '')
    .split('|')[0]
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function isCdekDelivery(delivery: string): boolean {
  const normalized = normalizeDeliveryLabel(delivery);
  return normalized.includes('сдэк') || normalized.includes('cdek');
}

function resolveCdekDeliveryType(order: OrderPayload): 'pickup' | 'door' {
  const explicitType = String(order.deliveryType || '').trim().toLowerCase();
  if (explicitType === 'door' || explicitType === 'pickup') return explicitType;

  const normalized = normalizeDeliveryLabel(order.delivery);
  if (
    normalized.includes('до двери') ||
    normalized.includes('двери') ||
    normalized.includes('курьер')
  ) {
    return 'door';
  }
  return 'pickup';
}

function resolveCdekTariffCode(order: OrderPayload): number | undefined {
  const explicitCode = Number(order.deliveryTariffCode);
  if (Number.isFinite(explicitCode) && explicitCode > 0) return Math.floor(explicitCode);

  const match = String(order.delivery || '').match(/тариф\s*(\d{2,4})/i);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function buildCdekCreatePayload(order: OrderPayload, leadId: number): CdekCreateOrderPayload {
  return {
    orderId: sanitizeMeta(order.orderId, 80),
    name: sanitizeMeta(order.name, 120),
    phone: sanitizeMeta(order.phone, 80),
    email: sanitizeMeta(order.email, 120),
    city: sanitizeMeta(order.city, 120),
    street: sanitizeMeta(order.street, 160),
    apartment: sanitizeMeta(order.apartment, 120),
    zip: sanitizeMeta(order.zip, 20),
    deliveryType: resolveCdekDeliveryType(order),
    tariffCode: resolveCdekTariffCode(order),
    // Русский комментарий: сохраняем привязку к лиду Б24 прямо в комментарии заказа СДЭК.
    comment: `Заказ с сайта CRYPTORO #${sanitizeMeta(order.orderId, 80)}, лид B24 #${leadId}`,
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
          sku: sanitizeMeta(item.sku, 80) || undefined,
          name: sanitizeMeta(item.name, 140),
          qty: Math.max(1, Number(item.qty) || 1),
          price: Math.max(0, Number(item.price) || 0),
        }))
      : [],
  };
}

async function maybeCreateCdekOrderForOrder(
  env: Env,
  order: OrderPayload,
  leadId: number,
  warnings: string[]
): Promise<CdekCreateOrderResult | undefined> {
  if (!isCdekDelivery(order.delivery)) return undefined;

  const cdekResult = await createCdekOrder(env, buildCdekCreatePayload(order, leadId));
  if (!cdekResult.ok) {
    warnings.push(`cdek_create_failed:${cdekResult.error}`);
    return cdekResult;
  }

  if (cdekResult.warning) warnings.push(cdekResult.warning);
  return cdekResult;
}

function parseEnumMap(rawJson: string | undefined): EnumMap {
  if (!rawJson || !rawJson.trim()) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as EnumMap;
  } catch {
    return {};
  }
}

function resolveDeliveryFieldValue(
  delivery: string,
  enumMap: EnumMap,
  requireEnum = false
): string | number | null {
  const normalized = normalizeDeliveryLabel(delivery);
  if (!normalized) return null;

  // Русский комментарий: для списка без enum-значений ничего не пишем, чтобы не ловить дефолт Б24.
  if (!Object.keys(enumMap).length) return requireEnum ? null : delivery;

  // Русский комментарий: для поля-списка в Б24 выбираем ID значения из маппинга по вхождению ключа.
  for (const [key, value] of Object.entries(enumMap)) {
    const normalizedKey = normalizeDeliveryLabel(key);
    if (!normalizedKey) continue;
    if (normalized.includes(normalizedKey)) return value;
  }

  // Русский комментарий: enum-карта задана, но совпадения нет — не устанавливаем поле,
  // чтобы Bitrix24 не использовал значение по умолчанию (например, "Самовывоз").
  return null;
}

async function setLeadProductRows(
  webhookUrl: string,
  leadId: number,
  rows: BitrixLeadProductRow[]
): Promise<ProductRowsSyncResult> {
  if (!rows.length) return { ok: true, method: 'skipped_empty_rows' };

  const legacyRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.productrows.set', {
    id: leadId,
    rows,
  });
  if (legacyRes.ok) return { ok: true, method: 'crm.lead.productrows.set' };

  // Русский комментарий: на части порталов работает новый endpoint с ownerType, на части — с ownerTypeId.
  const itemRes = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerType: 'L',
    ownerId: leadId,
    productRows: mapRowsToItemApi(rows),
  });
  if (itemRes.ok) return { ok: true, method: 'crm.item.productrow.set(ownerType=L)' };

  const itemResById = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerTypeId: 1,
    ownerId: leadId,
    productRows: mapRowsToItemApi(rows),
  });
  if (itemResById.ok) return { ok: true, method: 'crm.item.productrow.set(ownerTypeId=1)' };

  // Русский комментарий: если PRODUCT_ID невалидный для каталога Б24, пробуем записать строки как кастомные товары.
  const customRows = toCustomRows(rows);
  const legacyCustomRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.productrows.set', {
    id: leadId,
    rows: customRows,
  });
  if (legacyCustomRes.ok) return { ok: true, method: 'crm.lead.productrows.set(custom)' };

  const itemCustomRes = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerType: 'L',
    ownerId: leadId,
    productRows: mapRowsToItemApi(customRows),
  });
  if (itemCustomRes.ok) return { ok: true, method: 'crm.item.productrow.set(custom,ownerType=L)' };

  const itemCustomResById = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerTypeId: 1,
    ownerId: leadId,
    productRows: mapRowsToItemApi(customRows),
  });
  if (itemCustomResById.ok) return { ok: true, method: 'crm.item.productrow.set(custom,ownerTypeId=1)' };

  return {
    ok: false,
    warning: [
      'productrows_set_failed',
      formatBitrixError('lead_rows', legacyRes),
      formatBitrixError('item_ownerType', itemRes),
      formatBitrixError('item_ownerTypeId', itemResById),
      formatBitrixError('lead_rows_custom', legacyCustomRes),
      formatBitrixError('item_custom_ownerType', itemCustomRes),
      formatBitrixError('item_custom_ownerTypeId', itemCustomResById),
    ].join('|'),
  };
}

async function setDealProductRows(
  webhookUrl: string,
  dealId: number,
  rows: BitrixLeadProductRow[]
): Promise<ProductRowsSyncResult> {
  if (!rows.length) return { ok: true, method: 'skipped_empty_rows' };

  const legacyRes = await callBitrix<boolean>(webhookUrl, 'crm.deal.productrows.set', {
    id: dealId,
    rows,
  });
  if (legacyRes.ok) return { ok: true, method: 'crm.deal.productrows.set' };

  const itemRes = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerType: 'D',
    ownerId: dealId,
    productRows: mapRowsToItemApi(rows),
  });
  if (itemRes.ok) return { ok: true, method: 'crm.item.productrow.set(ownerType=D)' };

  const itemResById = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerTypeId: 2,
    ownerId: dealId,
    productRows: mapRowsToItemApi(rows),
  });
  if (itemResById.ok) return { ok: true, method: 'crm.item.productrow.set(ownerTypeId=2)' };

  const customRows = toCustomRows(rows);
  const legacyCustomRes = await callBitrix<boolean>(webhookUrl, 'crm.deal.productrows.set', {
    id: dealId,
    rows: customRows,
  });
  if (legacyCustomRes.ok) return { ok: true, method: 'crm.deal.productrows.set(custom)' };

  const itemCustomRes = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerType: 'D',
    ownerId: dealId,
    productRows: mapRowsToItemApi(customRows),
  });
  if (itemCustomRes.ok) return { ok: true, method: 'crm.item.productrow.set(custom,ownerType=D)' };

  const itemCustomResById = await callBitrix<boolean>(webhookUrl, 'crm.item.productrow.set', {
    ownerTypeId: 2,
    ownerId: dealId,
    productRows: mapRowsToItemApi(customRows),
  });
  if (itemCustomResById.ok) return { ok: true, method: 'crm.item.productrow.set(custom,ownerTypeId=2)' };

  return {
    ok: false,
    warning: [
      'deal_productrows_set_failed',
      formatBitrixError('deal_rows', legacyRes),
      formatBitrixError('item_ownerType', itemRes),
      formatBitrixError('item_ownerTypeId', itemResById),
      formatBitrixError('deal_rows_custom', legacyCustomRes),
      formatBitrixError('item_custom_ownerType', itemCustomRes),
      formatBitrixError('item_custom_ownerTypeId', itemCustomResById),
    ].join('|'),
  };
}

async function getDealProductRows(webhookUrl: string, dealId: number): Promise<Array<Record<string, unknown>> | null> {
  const res = await callBitrix<Array<Record<string, unknown>>>(webhookUrl, 'crm.deal.productrows.get', { id: dealId });
  if (res.ok === false) return null;
  return Array.isArray(res.data) ? res.data : [];
}

function extractRowLabel(row: Record<string, unknown>): string {
  return sanitizeMeta(String(row.PRODUCT_NAME || row.productName || row.NAME || ''), 180).toLowerCase();
}

function isDeliveryLikeRow(row: Record<string, unknown>): boolean {
  const label = extractRowLabel(row);
  if (!label) return false;
  return label.includes('доставк') || label.includes('самовывоз') || label.includes('pickup');
}

async function reconcileDealRows(
  webhookUrl: string,
  dealId: number,
  expectedRows: BitrixLeadProductRow[],
  warnings: string[]
): Promise<void> {
  // Русский комментарий: внешние роботы могут добавить "доставку-товар" с задержкой, поэтому проверяем несколько раз.
  let lastDeliveryLabels = '';
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const currentRows = await getDealProductRows(webhookUrl, dealId);
    if (!currentRows) {
      warnings.push('deal_productrows_get_failed');
      return;
    }

    const deliveryLikeRows = currentRows.filter((row) => isDeliveryLikeRow(row));
    if (!deliveryLikeRows.length) return;

    lastDeliveryLabels = deliveryLikeRows
      .map((row) => extractRowLabel(row))
      .filter(Boolean)
      .join(',');

    const resetRes = await setDealProductRows(webhookUrl, dealId, expectedRows);
    if (resetRes.ok === false) {
      warnings.push(`deal_productrows_reconcile_failed:${resetRes.warning}`);
      return;
    }

    await sleep(500);
  }

  if (lastDeliveryLabels) warnings.push(`deal_productrows_delivery_row_persisted:${lastDeliveryLabels}`);
}

async function findDealsByLeadId(webhookUrl: string, leadId: number): Promise<number[]> {
  const res = await callBitrix<Array<{ ID?: string | number }>>(webhookUrl, 'crm.deal.list', {
    filter: { LEAD_ID: leadId },
    order: { ID: 'DESC' },
    select: ['ID'],
  });
  if (res.ok === false) return [];

  return (res.data || [])
    .map((item) => Number(item?.ID))
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function waitDealsByLeadId(webhookUrl: string, leadId: number, maxAttempts = 6): Promise<number[]> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const dealIds = await findDealsByLeadId(webhookUrl, leadId);
    if (dealIds.length) return dealIds;
    await sleep(300);
  }
  return [];
}

async function syncConvertedDeal(
  webhookUrl: string,
  leadId: number,
  rows: BitrixLeadProductRow[],
  orderTotal: number,
  currencyId: string,
  customerName: string,
  channels: ContactChannels,
  delivery: string,
  deliveryCost: number | undefined,
  comments: string,
  env: Env,
  dealFieldConfig: ResolvedCrmFieldConfig,
  warnings: string[]
): Promise<string | undefined> {
  if (!shouldSyncDealOnConvert(env)) return undefined;

  const dealIds = await waitDealsByLeadId(webhookUrl, leadId);
  if (!dealIds.length) {
    warnings.push('deal_sync_not_found_by_lead');
    return undefined;
  }

  const dealId = dealIds[0];
  const dealFields: Record<string, unknown> = {
    OPPORTUNITY: orderTotal,
    CURRENCY_ID: currencyId,
    TITLE: `Заказ — ${sanitizeMeta(customerName, 120) || 'Клиент'}`,
    ...(comments ? { COMMENTS: comments } : {}),
  };

  if (dealFieldConfig.deliveryFieldCode && delivery) {
    // Русский комментарий: опционально пишем способ доставки в кастомное поле сделки (тип Список/Строка).
    // Если enum-карта задана, но совпадения нет — не перезаписываем поле (иначе Bitrix оставит "Самовывоз").
    const dv = resolveDeliveryFieldValue(
      delivery,
      dealFieldConfig.deliveryEnumMap,
      dealFieldConfig.deliveryFieldRequiresEnum
    );
    if (dv !== null) dealFields[dealFieldConfig.deliveryFieldCode] = dv;
  }
  if (dealFieldConfig.deliveryCostFieldCode && deliveryCost && deliveryCost > 0) {
    dealFields[dealFieldConfig.deliveryCostFieldCode] = deliveryCost;
  }
  if (dealFieldConfig.fullNameFieldCode) {
    dealFields[dealFieldConfig.fullNameFieldCode] = sanitizeMeta(customerName, 140);
  }
  if (dealFieldConfig.phoneFieldCode && channels.hasPhone) {
    dealFields[dealFieldConfig.phoneFieldCode] = channels.phoneRaw || channels.phoneNormalized;
  }
  if (dealFieldConfig.emailFieldCode && channels.hasEmail) {
    dealFields[dealFieldConfig.emailFieldCode] = channels.email;
  }

  const updateDealRes = await callBitrix<boolean>(webhookUrl, 'crm.deal.update', {
    id: dealId,
    fields: dealFields,
  });
  if (updateDealRes.ok === false) warnings.push(`deal_update_failed:${updateDealRes.error}`);

  const setRowsRes = await setDealProductRows(webhookUrl, dealId, rows);
  if (setRowsRes.ok === false) {
    warnings.push(setRowsRes.warning);
    return undefined;
  }
  await reconcileDealRows(webhookUrl, dealId, rows, warnings);

  return `${setRowsRes.method || 'unknown'}:deal#${dealId}`;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function getLeadVerifyInfo(webhookUrl: string, leadId: number): Promise<{ info?: LeadVerifyInfo; warning?: string }> {
  const leadGetRes = await callBitrix<Record<string, unknown>>(webhookUrl, 'crm.lead.get', { id: leadId });
  if (leadGetRes.ok === false) return { warning: `lead_get_failed:${leadGetRes.error}` };

  const rowsGetRes = await callBitrix<Array<Record<string, unknown>>>(webhookUrl, 'crm.lead.productrows.get', { id: leadId });
  if (rowsGetRes.ok === false) return { warning: `productrows_get_failed:${rowsGetRes.error}` };

  const lead = leadGetRes.data || {};
  const rows = Array.isArray(rowsGetRes.data) ? rowsGetRes.data : [];
  return {
    info: {
      opportunity: String(lead.OPPORTUNITY ?? ''),
      currencyId: String(lead.CURRENCY_ID ?? ''),
      productRowsCount: rows.length,
    },
  };
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

async function updateContactBasics(
  webhookUrl: string,
  contactId: number,
  payload: LeadPayload,
  channels: ContactChannels,
  env: Env
): Promise<string | undefined> {
  if (!shouldUpdateContactOnMatch(env)) return undefined;

  const personName = splitPersonName(payload.name);
  const fields: Record<string, unknown> = {
    NAME: personName.firstName,
    ...(personName.lastName ? { LAST_NAME: personName.lastName } : {}),
  };
  if (channels.hasPhone) fields.PHONE = [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }];
  if (channels.hasEmail) fields.EMAIL = [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }];

  const res = await callBitrix<boolean>(webhookUrl, 'crm.contact.update', {
    id: contactId,
    fields,
  });
  if (res.ok === false) return `contact_update_failed:${res.error}`;
  return undefined;
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
    if (existingByPhone) {
      const warning = await updateContactBasics(webhookUrl, existingByPhone, payload, channels, env);
      return { id: existingByPhone, ...(warning ? { warning } : {}) };
    }
  }
  if (channels.hasEmail) {
    const existingByEmail = await findContactByEmail(webhookUrl, channels.email);
    if (existingByEmail) {
      const warning = await updateContactBasics(webhookUrl, existingByEmail, payload, channels, env);
      return { id: existingByEmail, ...(warning ? { warning } : {}) };
    }
  }

  if (!channels.hasPhone && !channels.hasEmail && !channels.telegram) {
    return { id: null, warning: 'contact_sync_skipped_no_channels' };
  }

  const personName = splitPersonName(payload.name);
  const telegramFieldCode = sanitizeMeta(env.B24_TELEGRAM_FIELD_CODE, 80);
  const contactSourceId = parseB24SourceId(env.B24_CONTACT_SOURCE_ID);

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
    ...(contactSourceId ? { SOURCE_ID: contactSourceId } : {}),
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
  const leadSourceId = parseB24SourceId(env.B24_LEAD_SOURCE_ID);
  const channels = parseContactChannels(phone, email);
  const productMap = parseProductMap(env.B24_PRODUCT_MAP_JSON);
  const currencyId = sanitizeMeta(env.B24_CURRENCY_ID || 'RUB', 6) || 'RUB';
  const consultComment = !isOrder ? String((body as ConsultPayload).comment || '').trim() : '';
  const rawEntryPoint = sanitizeMeta((body as ConsultPayload | OrderPayload).entryPoint, 80);
  const sourcePage = sanitizeMeta((body as ConsultPayload | OrderPayload).sourcePage, 120);
  const sourceButton = sanitizeMeta((body as ConsultPayload | OrderPayload).sourceButton, 120);
  const entryPoint = rawEntryPoint || (isOrder ? 'cart_checkout_default' : 'consult_default');
  const personName = splitPersonName(name);
  const orderItemsTotal = isOrder && o ? calculateOrderTotal(o.items, o.total) : 0;
  const orderDeliveryCost = isOrder && o ? Number(parseAmount(o.deliveryCost).toFixed(2)) : 0;
  const orderOpportunity = isOrder && o ? calculateOrderOpportunity(o.items, o.total, o.deliveryCost) : 0;
  const warnings: string[] = [];
  const leadFieldConfig = await resolveCrmFieldConfig(webhookUrl, 'lead', env, warnings);
  const dealFieldConfig = isOrder
    ? await resolveCrmFieldConfig(webhookUrl, 'deal', env, warnings)
    : EMPTY_CRM_FIELD_CONFIG;
  let productRowsSyncMethod: string | undefined;

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
        `Стоимость доставки: ${orderDeliveryCost > 0 ? formatRub(orderDeliveryCost) : '—'}`,
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
        `Товары: ${orderItemsTotal > 0 ? formatRub(orderItemsTotal) : (o.total || '—')}`,
        `Итого с доставкой: ${orderOpportunity > 0 ? formatRub(orderOpportunity) : '—'}`,
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
    let cdekOrder: CdekCreateOrderResult | undefined;
    if (isOrder && o) {
      const updateRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.update', {
        id: existingId,
        fields: {
          NAME: personName.firstName,
          ...(personName.lastName ? { LAST_NAME: personName.lastName } : {}),
          OPPORTUNITY: orderOpportunity,
          CURRENCY_ID: currencyId,
          ...(channels.hasPhone ? { PHONE: [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }] } : {}),
          ...(channels.hasEmail ? { EMAIL: [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }] } : {}),
          ...(() => {
            if (!leadFieldConfig.deliveryFieldCode || !o.delivery) return {};
            const dv = resolveDeliveryFieldValue(
              String(o.delivery),
              leadFieldConfig.deliveryEnumMap,
              leadFieldConfig.deliveryFieldRequiresEnum
            );
            return dv !== null ? { [leadFieldConfig.deliveryFieldCode]: dv } : {};
          })(),
          ...(leadFieldConfig.deliveryCostFieldCode && o.deliveryCost && o.deliveryCost > 0
            ? { [leadFieldConfig.deliveryCostFieldCode]: o.deliveryCost }
            : {}),
          ...(leadFieldConfig.fullNameFieldCode ? { [leadFieldConfig.fullNameFieldCode]: sanitizeMeta(name, 140) } : {}),
          ...(leadFieldConfig.phoneFieldCode && channels.hasPhone
            ? { [leadFieldConfig.phoneFieldCode]: channels.phoneRaw || channels.phoneNormalized }
            : {}),
          ...(leadFieldConfig.emailFieldCode && channels.hasEmail ? { [leadFieldConfig.emailFieldCode]: channels.email } : {}),
          ...(comments ? { COMMENTS: comments } : {}),
        },
      });
      if (updateRes.ok === false) warnings.push(`lead_order_update_failed:${updateRes.error}`);

      const { rows, unmappedItems } = buildProductRows(o.items, productMap);
      if (unmappedItems > 0) warnings.push(`productrows_unmapped_items:${unmappedItems}`);
      if (rows.length) {
        const setRowsRes = await setLeadProductRows(webhookUrl, existingId, rows);
        if (setRowsRes.ok === false) warnings.push(setRowsRes.warning);
        else productRowsSyncMethod = setRowsRes.method;

        const dealSyncMethod = await syncConvertedDeal(
          webhookUrl,
          existingId,
          rows,
          orderOpportunity,
          currencyId,
          name,
          channels,
          String(o.delivery || ''),
          o.deliveryCost,
          comments,
          env,
          dealFieldConfig,
          warnings
        );
        if (dealSyncMethod) productRowsSyncMethod = `${productRowsSyncMethod || 'lead_unknown'}|${dealSyncMethod}`;
      } else {
        warnings.push('productrows_not_mapped');
      }

      cdekOrder = await maybeCreateCdekOrderForOrder(env, o, existingId, warnings);
    }

    if (!isOrder) {
      const consultUpdateRes = await callBitrix<boolean>(webhookUrl, 'crm.lead.update', {
        id: existingId,
        fields: {
          TITLE: title,
          NAME: personName.firstName,
          ...(personName.lastName ? { LAST_NAME: personName.lastName } : {}),
          ...(channels.hasPhone ? { PHONE: [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }] } : {}),
          ...(channels.hasEmail ? { EMAIL: [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }] } : {}),
          ...(leadFieldConfig.fullNameFieldCode ? { [leadFieldConfig.fullNameFieldCode]: sanitizeMeta(name, 140) } : {}),
          ...(leadFieldConfig.phoneFieldCode && channels.hasPhone
            ? { [leadFieldConfig.phoneFieldCode]: channels.phoneRaw || channels.phoneNormalized }
            : {}),
          ...(leadFieldConfig.emailFieldCode && channels.hasEmail ? { [leadFieldConfig.emailFieldCode]: channels.email } : {}),
          ...(contactId ? { CONTACT_ID: contactId } : {}),
          ...(comments ? { COMMENTS: comments } : {}),
        },
      });
      if (consultUpdateRes.ok === false) warnings.push(`lead_consult_update_failed:${consultUpdateRes.error}`);
    }
    let verify: LeadVerifyInfo | undefined;
    if (isOrder) {
      const verifyRes = await getLeadVerifyInfo(webhookUrl, existingId);
      if (verifyRes.warning) warnings.push(verifyRes.warning);
      if (verifyRes.info) verify = verifyRes.info;
    }
    return new Response(JSON.stringify({
      ok: true,
      id: existingId,
      duplicate: true,
      ...(productRowsSyncMethod ? { productRowsSyncMethod } : {}),
      ...(cdekOrder ? { cdekOrder } : {}),
      ...(verify ? { verify } : {}),
      ...(warnings.length ? { warnings } : {}),
    }), {
      headers,
    });
  }

  const fields: Record<string, unknown> = {
    TITLE: title,
    NAME: personName.firstName,
    ...(personName.lastName ? { LAST_NAME: personName.lastName } : {}),
    ...(leadSourceId ? { SOURCE_ID: leadSourceId } : {}),
    // Русский комментарий: сохраняем точку входа, чтобы в CRM различать каждую кнопку/форму.
    SOURCE_DESCRIPTION: `${isOrder ? 'Корзина' : 'Консультация по диктофонам'} | ${entryPoint}`,
    ORIGINATOR_ID: originatorId,
    ORIGIN_ID: dedupeOriginId,
  };
  if (isOrder && o) {
    // Русский комментарий: заполняем сумму лида явно, чтобы в Bitrix не оставался 0.
    fields.OPPORTUNITY = orderOpportunity;
    fields.CURRENCY_ID = currencyId;
    if (leadFieldConfig.deliveryFieldCode && o.delivery) {
      // Русский комментарий: если enum-карта задана, но ключ не найден — не пишем поле,
      // чтобы Bitrix не подставил значение по умолчанию (например, "Самовывоз").
      const dv = resolveDeliveryFieldValue(
        String(o.delivery),
        leadFieldConfig.deliveryEnumMap,
        leadFieldConfig.deliveryFieldRequiresEnum
      );
      if (dv !== null) fields[leadFieldConfig.deliveryFieldCode] = dv;
    }
    if (leadFieldConfig.deliveryCostFieldCode && o.deliveryCost && o.deliveryCost > 0) {
      fields[leadFieldConfig.deliveryCostFieldCode] = o.deliveryCost;
    }
    if (orderOpportunity <= 0) warnings.push('order_total_zero');
  }
  if (channels.hasPhone) fields.PHONE = [{ VALUE: channels.phoneRaw, VALUE_TYPE: 'WORK' }];
  if (channels.hasEmail) fields.EMAIL = [{ VALUE: channels.email, VALUE_TYPE: 'WORK' }];
  if (leadFieldConfig.fullNameFieldCode) fields[leadFieldConfig.fullNameFieldCode] = sanitizeMeta(name, 140);
  if (leadFieldConfig.phoneFieldCode && channels.hasPhone) {
    fields[leadFieldConfig.phoneFieldCode] = channels.phoneRaw || channels.phoneNormalized;
  }
  if (leadFieldConfig.emailFieldCode && channels.hasEmail) fields[leadFieldConfig.emailFieldCode] = channels.email;
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
    const { rows, unmappedItems } = buildProductRows(o.items, productMap);
    if (unmappedItems > 0) warnings.push(`productrows_unmapped_items:${unmappedItems}`);
    if (rows.length) {
      // Русский комментарий: добавляем товарные позиции в лид Bitrix, чтобы менеджер видел корзину в блоке "Товары".
      const setRowsRes = await setLeadProductRows(webhookUrl, createLeadRes.data, rows);
      if (setRowsRes.ok === false) warnings.push(setRowsRes.warning);
      else productRowsSyncMethod = setRowsRes.method;

      const dealSyncMethod = await syncConvertedDeal(
        webhookUrl,
        createLeadRes.data,
        rows,
        orderOpportunity,
        currencyId,
        name,
        channels,
        String(o.delivery || ''),
        o.deliveryCost,
        comments,
        env,
        dealFieldConfig,
        warnings
      );
      if (dealSyncMethod) productRowsSyncMethod = `${productRowsSyncMethod || 'lead_unknown'}|${dealSyncMethod}`;
    } else {
      warnings.push('productrows_not_mapped');
    }
  }
  const cdekOrder = isOrder && o ? await maybeCreateCdekOrderForOrder(env, o, createLeadRes.data, warnings) : undefined;
  let verify: LeadVerifyInfo | undefined;
  if (isOrder) {
    const verifyRes = await getLeadVerifyInfo(webhookUrl, createLeadRes.data);
    if (verifyRes.warning) warnings.push(verifyRes.warning);
    if (verifyRes.info) verify = verifyRes.info;
  }

  return new Response(JSON.stringify({
    ok: true,
    id: createLeadRes.data,
    ...(productRowsSyncMethod ? { productRowsSyncMethod } : {}),
    ...(cdekOrder ? { cdekOrder } : {}),
    ...(verify ? { verify } : {}),
    ...(warnings.length ? { warnings } : {}),
  }), {
    headers,
  });
};
