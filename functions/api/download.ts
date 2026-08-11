/**
 * POST /api/download
 *
 * Receives { slug, code } from a plain <form>, validates the code against D1,
 * checks whether its level reaches the requested file, logs the event
 * (including invalid attempts), and returns the file read from the private
 * R2 bucket.
 *
 * The R2 object is never exposed: there's no public URL, no signed redirect —
 * the file body streams through here.
 */
import { FILE_BY_SLUG, canAccess } from '../../shared/files';

export interface Env {
  /** Private R2 bucket holding the files */
  FILES: R2Bucket;
  /** D1 database with the `codes` and `access_log` tables */
  DB: D1Database;
  /** Secret used to hash the IP before storing it (we never store raw IPs) */
  IP_SALT: string;
}

/** Invalid attempts tolerated per IP within the window below. */
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

/**
 * Values stored in `access_log.ok`.
 *
 * `DENIED` is a legitimate code hitting a file above its level. It's kept
 * separate from `INVALID` for two reasons: it doesn't count toward the
 * brute-force throttle (someone with a real listed code shouldn't get locked
 * out for knocking on a door that isn't theirs), and in the panel it's a
 * different signal — not a leaked code, but someone requesting more material
 * than they were granted.
 */
const LOG_INVALID = 0;
const LOG_OK = 1;
const LOG_DENIED = 2;

/** Accepts the entered code with or without hyphens, spaces, or lowercase. */
function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** Safe Content-Disposition for accented filenames (RFC 5987). */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function backToForm(request: Request, slug: string, reason: string): Response {
  const url = new URL(`/d/${slug}`, request.url);
  url.searchParams.set('erro', reason);
  // 303 forces the browser to swap the POST for a GET on the way back.
  return Response.redirect(url.toString(), 303);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const slug = String(form.get('slug') ?? '');
  const code = normalizeCode(String(form.get('code') ?? ''));

  const file = FILE_BY_SLUG[slug];
  if (!file) {
    return new Response('Not found', { status: 404 });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(ip, env.IP_SALT ?? 'no-salt-configured');
  const country = (request as { cf?: { country?: string } }).cf?.country ?? null;
  const ua = request.headers.get('User-Agent')?.slice(0, 300) ?? null;
  const now = new Date().toISOString();

  const logAccess = (ok: number, label: string | null) =>
    env.DB.prepare(
      `INSERT INTO access_log (code, label, slug, ok, ts, country, ip_hash, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(code || null, label, slug, ok, now, country, ipHash, ua)
      .run();

  // Brute-force throttle: 100 valid codes in a small space would be swept
  // fast without this. `ts` is ISO 8601 UTC, so comparing as text is
  // equivalent to comparing as a date.
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const failed = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM access_log WHERE ip_hash = ? AND ok = 0 AND ts > ?`
  )
    .bind(ipHash, since)
    .first<{ n: number }>();

  if ((failed?.n ?? 0) >= MAX_FAILED_ATTEMPTS) {
    return backToForm(request, slug, 'rate');
  }

  const row = code
    ? await env.DB.prepare(`SELECT label, level FROM codes WHERE code = ?`)
        .bind(code)
        .first<{ label: string; level: number }>()
    : null;

  if (!row) {
    await logAccess(LOG_INVALID, null);
    return backToForm(request, slug, '1');
  }

  // Level 0 opens nothing: that's how a code gets blocked without being
  // deleted. To whoever typed it, a blocked code is indistinguishable from
  // an invalid one — there's no reason to reveal that it ever existed.
  if (!canAccess(row.level, file)) {
    await logAccess(LOG_DENIED, row.label);
    return backToForm(request, slug, row.level > 0 ? 'nivel' : '1');
  }

  const object = await env.FILES.get(file.r2Key);
  if (!object) {
    // Code was valid, but the file isn't in the bucket: our error, not the
    // person's. We log it as an authorized access so it doesn't vanish from
    // the stats.
    await logAccess(LOG_OK, row.label);
    return new Response('File temporarily unavailable.', { status: 503 });
  }

  await logAccess(LOG_OK, row.label);

  return new Response(object.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.downloadName),
      'Content-Length': String(object.size),
      // Without this, Cloudflare's edge could serve the file to someone who
      // never entered a code at all.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
