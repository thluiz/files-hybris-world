/**
 * POST /api/download
 *
 * Recebe { slug, code } de um <form> comum, valida o código no D1, confere se o
 * nível dele alcança o arquivo pedido, registra o evento (inclusive as
 * tentativas inválidas) e devolve o arquivo lido do bucket R2 privado.
 *
 * O objeto do R2 nunca é exposto: não há URL pública, nem redirect assinado —
 * o corpo do arquivo passa por aqui como stream.
 */
import { FILE_BY_SLUG, canAccess } from '../../shared/files';

export interface Env {
  /** Bucket R2 privado com os arquivos */
  FILES: R2Bucket;
  /** Banco D1 com as tabelas `codes` e `access_log` */
  DB: D1Database;
  /** Segredo usado para hashear o IP antes de gravar (não guardamos IP cru) */
  IP_SALT: string;
}

/** Tentativas inválidas toleradas por IP dentro da janela abaixo. */
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

/**
 * Valores gravados em `access_log.ok`.
 *
 * `DENIED` é código legítimo esbarrando num arquivo acima do nível dele. Fica
 * separado de `INVALID` por dois motivos: não conta no freio de força bruta
 * (quem tem código da lista não pode ser trancado por bater numa porta que não
 * é dele) e, no painel, é um sinal diferente — não é código vazado, é alguém
 * pedindo mais material do que recebeu.
 */
const LOG_INVALID = 0;
const LOG_OK = 1;
const LOG_DENIED = 2;

/** Aceita o código digitado com ou sem hífen, espaço ou minúscula. */
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

/** Content-Disposition seguro para nomes com acento (RFC 5987). */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function backToForm(request: Request, slug: string, reason: string): Response {
  const url = new URL(`/d/${slug}`, request.url);
  url.searchParams.set('erro', reason);
  // 303 força o browser a trocar o POST por um GET na volta.
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

  // Freio de força bruta: 100 códigos válidos num espaço pequeno seriam
  // varridos rápido sem isto. `ts` é ISO 8601 UTC, então comparar como texto
  // equivale a comparar como data.
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

  // Nível 0 não abre nada: é assim que um código é bloqueado sem ser apagado.
  // Para quem digitou, um código bloqueado é indistinguível de um inválido —
  // não há por que informar que ele já existiu.
  if (!canAccess(row.level, file)) {
    await logAccess(LOG_DENIED, row.label);
    return backToForm(request, slug, row.level > 0 ? 'nivel' : '1');
  }

  const object = await env.FILES.get(file.r2Key);
  if (!object) {
    // Código era válido, mas o arquivo não está no bucket: erro nosso, não da
    // pessoa. Logamos como acesso autorizado para não sumir da estatística.
    await logAccess(LOG_OK, row.label);
    return new Response('File temporarily unavailable.', { status: 503 });
  }

  await logAccess(LOG_OK, row.label);

  return new Response(object.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.downloadName),
      'Content-Length': String(object.size),
      // Sem isto, a borda da Cloudflare poderia servir o arquivo a quem não
      // digitou código nenhum.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
