type Env = {
  PK_POST_SECRET?: string;
  PK_IDEMPOTENCY_TTL_SEC?: string;
  PK_IDEMPOTENCY_KV?: KVNamespace;
};

const DEFAULT_IDEMPOTENCY_TTL_SEC = 60 * 60 * 24 * 14;
const processedInMemory = new Map<string, number>();

function toText(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function parseTtlSec(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDEMPOTENCY_TTL_SEC;
  return Math.floor(parsed);
}

function cleanupInMemory(now: number): void {
  if (processedInMemory.size < 500) return;
  for (const [key, expiresAt] of processedInMemory.entries()) {
    if (expiresAt <= now) processedInMemory.delete(key);
  }
}

async function isAlreadyProcessed(env: Env, operationId: string, now: number): Promise<boolean> {
  cleanupInMemory(now);
  const inMemory = processedInMemory.get(operationId);
  if (inMemory && inMemory > now) return true;
  if (inMemory && inMemory <= now) processedInMemory.delete(operationId);

  if (!env.PK_IDEMPOTENCY_KV) return false;
  const kvValue = await env.PK_IDEMPOTENCY_KV.get(`pk:op:${operationId}`);
  return Boolean(kvValue);
}

async function markProcessed(env: Env, operationId: string, sum: string, orderId: string, clientId: string, ttlSec: number, now: number): Promise<void> {
  processedInMemory.set(operationId, now + ttlSec * 1000);
  if (!env.PK_IDEMPOTENCY_KV) return;

  const key = `pk:op:${operationId}`;
  const payload = JSON.stringify({
    operationId,
    sum,
    orderId,
    clientId,
    processedAt: new Date(now).toISOString(),
  });
  await env.PK_IDEMPOTENCY_KV.put(key, payload, { expirationTtl: ttlSec });
}

function leftRotate(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function md5Hex(input: string): string {
  // Русский комментарий: PayKeeper использует MD5-подпись для POST-оповещений.
  const bytes = new TextEncoder().encode(input);
  const originalBitLength = bytes.length * 8;

  const withOne = bytes.length + 1;
  const padLen = withOne % 64 <= 56 ? 56 - (withOne % 64) : 56 + (64 - (withOne % 64));
  const totalLen = withOne + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  const bitLenLow = originalBitLength >>> 0;
  const bitLenHigh = Math.floor(originalBitLength / 0x100000000) >>> 0;
  const tail = totalLen - 8;
  padded[tail] = bitLenLow & 0xff;
  padded[tail + 1] = (bitLenLow >>> 8) & 0xff;
  padded[tail + 2] = (bitLenLow >>> 16) & 0xff;
  padded[tail + 3] = (bitLenLow >>> 24) & 0xff;
  padded[tail + 4] = bitLenHigh & 0xff;
  padded[tail + 5] = (bitLenHigh >>> 8) & 0xff;
  padded[tail + 6] = (bitLenHigh >>> 16) & 0xff;
  padded[tail + 7] = (bitLenHigh >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      const idx = offset + i * 4;
      m[i] = (
        padded[idx] |
        (padded[idx + 1] << 8) |
        (padded[idx + 2] << 16) |
        (padded[idx + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f = 0;
      let g = 0;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + k[i] + m[g]) >>> 0;
      b = (b + leftRotate(sum, s[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  function toHexLe(word: number): string {
    const b1 = (word & 0xff).toString(16).padStart(2, '0');
    const b2 = ((word >>> 8) & 0xff).toString(16).padStart(2, '0');
    const b3 = ((word >>> 16) & 0xff).toString(16).padStart(2, '0');
    const b4 = ((word >>> 24) & 0xff).toString(16).padStart(2, '0');
    return `${b1}${b2}${b3}${b4}`;
  }

  return `${toHexLe(a0)}${toHexLe(b0)}${toHexLe(c0)}${toHexLe(d0)}`;
}

function safeEqualHex(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const secret = String(env.PK_POST_SECRET || '').trim();
  if (!secret) {
    return toText(500, 'Error! PayKeeper secret is not configured');
  }

  const rawBody = await request.text();
  const form = new URLSearchParams(rawBody);
  const operationId = String(form.get('id') || '').trim();
  const sumRaw = String(form.get('sum') || '').trim().replace(',', '.');
  const clientId = String(form.get('clientid') || '').trim();
  const orderId = String(form.get('orderid') || '').trim();
  const key = String(form.get('key') || '').trim();

  if (!operationId || !sumRaw || !key) {
    return toText(400, 'Error! Missing required fields');
  }

  const sumNumber = Number(sumRaw);
  if (!Number.isFinite(sumNumber) || sumNumber <= 0) {
    return toText(400, 'Error! Invalid sum');
  }
  const normalizedSum = sumNumber.toFixed(2);

  const expectedKey = md5Hex(`${operationId}${normalizedSum}${clientId}${orderId}${secret}`);
  if (!safeEqualHex(key, expectedKey)) {
    return toText(401, 'Error! Invalid signature');
  }

  const now = Date.now();
  const ttlSec = parseTtlSec(env.PK_IDEMPOTENCY_TTL_SEC);
  const alreadyProcessed = await isAlreadyProcessed(env, operationId, now);

  // Русский комментарий: всегда возвращаем корректный ACK после валидации подписи, чтобы PayKeeper не ретраил одно и то же событие.
  const ack = `OK ${md5Hex(`${operationId}${secret}`)}`;
  if (alreadyProcessed) {
    return toText(200, ack);
  }

  // Русский комментарий: пока без бизнес-обработки, только фиксируем уникальный operation_id.
  await markProcessed(env, operationId, normalizedSum, orderId, clientId, ttlSec, now);
  return toText(200, ack);
};

