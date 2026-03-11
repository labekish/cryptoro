type GuardEnv = {
  API_ALLOWED_ORIGINS?: string;
  API_REQUEST_SIGNING_SECRET?: string;
  SECURITY_ALLOW_MISSING_ORIGIN?: string;
  SECURITY_RATE_LIMIT_MAX?: string;
  SECURITY_RATE_LIMIT_WINDOW_SEC?: string;
  SECURITY_RATE_LIMIT_KV?: KVNamespace;
};

type GuardResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
    };

type GuardOptions = {
  scope: string;
  maxPerWindow?: number;
  windowSec?: number;
};

function parsePositiveInt(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseCsv(input: unknown): string[] {
  return String(input || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return '';
  }
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return toHex(new Uint8Array(signature));
}

function readClientIp(request: Request): string {
  const cfIp = String(request.headers.get('cf-connecting-ip') || '').trim();
  if (cfIp) return cfIp;
  const forwarded = String(request.headers.get('x-forwarded-for') || '').trim();
  if (!forwarded) return 'unknown';
  return forwarded.split(',')[0].trim() || 'unknown';
}

async function checkRateLimit(request: Request, env: GuardEnv, scope: string, maxPerWindow: number, windowSec: number): Promise<GuardResult> {
  const kv = env.SECURITY_RATE_LIMIT_KV;
  if (!kv) return { ok: true };

  const ip = readClientIp(request);
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${scope}:${ip}:${bucket}`;
  const currentRaw = await kv.get(key);
  const current = parsePositiveInt(currentRaw, 0);

  if (current >= maxPerWindow) {
    return { ok: false, status: 429, error: 'rate_limited' };
  }

  await kv.put(key, String(current + 1), { expirationTtl: windowSec + 10 });
  return { ok: true };
}

function checkOrigin(request: Request, env: GuardEnv): GuardResult {
  const allowMissingOrigin = String(env.SECURITY_ALLOW_MISSING_ORIGIN || '').trim() === '1';
  const requestOrigin = normalizeOrigin(request.url);
  const configuredRaw = parseCsv(env.API_ALLOWED_ORIGINS);
  const allowAll = configuredRaw.includes('*');
  const configured = configuredRaw
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
  const allowSet = new Set<string>([requestOrigin, ...configured]);

  const originHeader = String(request.headers.get('origin') || '').trim();
  const refererHeader = String(request.headers.get('referer') || '').trim();
  const candidates = [normalizeOrigin(originHeader), normalizeOrigin(refererHeader)].filter(Boolean);

  if (!candidates.length) {
    if (allowMissingOrigin) return { ok: true };
    return { ok: false, status: 403, error: 'origin_required' };
  }

  if (allowAll) return { ok: true };
  if (candidates.some((origin) => allowSet.has(origin))) return { ok: true };
  return { ok: false, status: 403, error: 'origin_forbidden' };
}

async function checkSignature(request: Request, env: GuardEnv): Promise<GuardResult> {
  const secret = String(env.API_REQUEST_SIGNING_SECRET || '').trim();
  if (!secret) return { ok: true };

  const timestampRaw = String(request.headers.get('x-cr-timestamp') || '').trim();
  const signatureRaw = String(request.headers.get('x-cr-signature') || '').trim();
  const signature = signatureRaw.replace(/^sha256=/i, '').trim().toLowerCase();

  if (!timestampRaw || !signature) {
    return { ok: false, status: 401, error: 'missing_signature' };
  }

  const timestampRawNumber = Number(timestampRaw);
  const timestampMs = timestampRawNumber > 1e12 ? timestampRawNumber : timestampRawNumber * 1000;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 401, error: 'invalid_signature_timestamp' };
  }

  const skewMs = Math.abs(Date.now() - timestampMs);
  if (skewMs > 5 * 60 * 1000) {
    return { ok: false, status: 401, error: 'stale_signature' };
  }

  const body = await request.clone().text();
  const payload = `${timestampRaw}.${body}`;
  const expected = await hmacSha256Hex(secret, payload);

  if (!secureEqual(signature, expected)) {
    return { ok: false, status: 401, error: 'invalid_signature' };
  }

  return { ok: true };
}

export async function guardMutationRequest(request: Request, env: GuardEnv, options: GuardOptions): Promise<GuardResult> {
  const originCheck = checkOrigin(request, env);
  if (!originCheck.ok) return originCheck;

  const signatureCheck = await checkSignature(request, env);
  if (!signatureCheck.ok) return signatureCheck;

  const maxPerWindow = parsePositiveInt(options.maxPerWindow ?? env.SECURITY_RATE_LIMIT_MAX, 30);
  const windowSec = parsePositiveInt(options.windowSec ?? env.SECURITY_RATE_LIMIT_WINDOW_SEC, 60);
  const limitCheck = await checkRateLimit(request, env, options.scope, maxPerWindow, windowSec);
  if (!limitCheck.ok) return limitCheck;

  return { ok: true };
}
