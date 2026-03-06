type MsPriceItem = {
  price?: number;
};

type MsPayload = {
  ok?: boolean;
  items?: Record<string, MsPriceItem>;
};

function getEdgeCache(): Cache {
  const withDefault = caches as unknown as { default?: Cache };
  return withDefault.default || (caches as unknown as Cache);
}

function extractPriceSlugs(html: string): string[] {
  const set = new Set<string>();
  const regex = /data-ms-price="([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    const slug = String(match[1] || '').trim();
    if (slug) set.add(slug);
  }
  return Array.from(set);
}

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

async function getMsPrices(requestUrl: string, slugs: string[]): Promise<Record<string, MsPriceItem>> {
  if (!slugs.length) return {};

  const url = new URL('/api/moysklad/prices', requestUrl);
  url.searchParams.set('slugs', slugs.join(','));
  const cacheKey = new Request(url.toString(), { method: 'GET' });

  // Русский комментарий: короткий edge-кэш снижает задержку и нагрузку на API МойСклад.
  const edgeCache = getEdgeCache();
  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    const payload = (await cached.json().catch(() => ({}))) as MsPayload;
    return payload?.ok && payload.items ? payload.items : {};
  }

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) return {};

  const payload = (await response.json().catch(() => ({}))) as MsPayload;
  const items = payload?.ok && payload.items ? payload.items : {};
  if (!Object.keys(items).length) return {};

  const cacheResponse = new Response(JSON.stringify({ ok: true, items }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=90',
    },
  });
  await edgeCache.put(cacheKey, cacheResponse);
  return items;
}

async function rewriteHtmlWithMsPrices(html: string, items: Record<string, MsPriceItem>): Promise<string> {
  const HtmlRewriterCtor = (globalThis as unknown as { HTMLRewriter?: any }).HTMLRewriter;
  if (!HtmlRewriterCtor) return html;

  const rewriter = new HtmlRewriterCtor().on('[data-ms-price]', {
    element(element) {
      const slug = element.getAttribute('data-ms-price');
      if (!slug) return;

      const price = Number(items?.[slug]?.price);
      if (!Number.isFinite(price) || price <= 0) return;

      element.setAttribute('data-ms-price-value', String(Math.round(price)));
      // Русский комментарий: подставляем итоговую цену прямо в HTML до отдачи браузеру.
      element.setInnerContent(formatRub(price));
    },
  });

  return rewriter
    .transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }))
    .text();
}

export const onRequest = async (context: { request: Request; next: () => Promise<Response> }): Promise<Response> => {
  const { request, next } = context;
  const url = new URL(request.url);
  const env = (context as { env?: { MS_EDGE_PRICE_SYNC?: string } }).env;
  const edgePriceSyncEnabled = String(env?.MS_EDGE_PRICE_SYNC || '').trim() === '1';

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return next();
  }
  // Русский комментарий: по умолчанию подмена цен на edge отключена, чтобы использовать фиксированные цены из контента.
  if (!edgePriceSyncEnabled) {
    return next();
  }

  const response = await next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.clone().text();
  if (!html.includes('data-ms-price=')) return response;

  const slugs = extractPriceSlugs(html);
  if (!slugs.length) return response;

  try {
    const items = await getMsPrices(request.url, slugs);
    if (!Object.keys(items).length) return response;

    const rewrittenHtml = await rewriteHtmlWithMsPrices(html, items);
    const headers = new Headers(response.headers);
    headers.set('x-ms-edge-prices', '1');

    return new Response(rewrittenHtml, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};
