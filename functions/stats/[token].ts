/**
 * GET /stats/<token>
 *
 * Painel de acompanhamento: quem baixou o quê, quantas vezes, e quais códigos
 * ainda não foram usados.
 *
 * A URL é a credencial. O token esperado vive no secret STATS_TOKEN — nunca no
 * código, porque este repositório é público. Token errado devolve 404, não 403:
 * quem chutar não descobre que o caminho existe.
 *
 * Esta página lista os códigos em claro. Se ela vazar, vaza tudo — por isso o
 * noindex, o no-store e a resposta 404 genérica.
 */
import { FILES } from '../../shared/files';

export interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
}

/** Comparação sem atalho de tempo, para o token não ser descoberto byte a byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "2026-08-11T02:31:07.123Z" → "11/08 02:31" */
function shortDate(ts: string | null): string {
  if (!ts) return '—';
  return `${ts.slice(8, 10)}/${ts.slice(5, 7)} ${ts.slice(11, 16)}`;
}

const TITLE_BY_SLUG = Object.fromEntries(FILES.map((f) => [f.slug, f.title]));

interface CodeRow {
  label: string;
  code: string;
  active: number;
  downloads: number;
  arquivos: number;
  ultimo: string | null;
}

interface FileRow {
  slug: string;
  downloads: number;
  pessoas: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const token = String(params.token ?? '');
  const notFound = new Response('Not found', { status: 404 });

  if (!env.STATS_TOKEN || !safeEqual(token, env.STATS_TOKEN)) {
    return notFound;
  }

  const [codes, byFile, invalid] = await Promise.all([
    env.DB.prepare(
      `SELECT c.label, c.code, c.active,
              COUNT(a.id)             AS downloads,
              COUNT(DISTINCT a.slug)  AS arquivos,
              MAX(a.ts)               AS ultimo
       FROM codes c
       LEFT JOIN access_log a ON a.code = c.code AND a.ok = 1
       GROUP BY c.code
       ORDER BY downloads DESC, c.label ASC`
    ).all<CodeRow>(),
    env.DB.prepare(
      `SELECT slug, COUNT(*) AS downloads, COUNT(DISTINCT code) AS pessoas
       FROM access_log WHERE ok = 1
       GROUP BY slug`
    ).all<FileRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM access_log WHERE ok = 0`
    ).first<{ n: number }>(),
  ]);

  const rows = codes.results ?? [];
  const usados = rows.filter((r) => r.downloads > 0).length;
  const totalDownloads = rows.reduce((sum, r) => sum + r.downloads, 0);

  // Ordena pelo catálogo, não pelo que o banco devolveu: arquivo sem nenhum
  // download precisa aparecer na tabela como zero, não sumir dela.
  const fileStats = FILES.map((f) => {
    const hit = (byFile.results ?? []).find((b) => b.slug === f.slug);
    return { title: f.title, downloads: hit?.downloads ?? 0, pessoas: hit?.pessoas ?? 0 };
  });

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Acessos — Hybris</title>
<style>
  :root { --cream:#cabf9d; --ink:#1a120a; --soft:#4a3d2c; --gold:#a8873f; }
  * { box-sizing:border-box; }
  body { margin:0; padding:2rem 1.25rem; background:#cabf9d; color:var(--ink);
         font-family:Georgia,'Times New Roman',serif; line-height:1.5; }
  .wrap { max-width:60rem; margin:0 auto; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; }
  h2 { font-size:1rem; letter-spacing:.16em; text-transform:uppercase;
       color:var(--soft); margin:2.5rem 0 .75rem; font-weight:400; }
  .sub { color:var(--soft); margin:0 0 2rem; font-size:.9rem; }
  .cards { display:flex; flex-wrap:wrap; gap:.75rem; }
  .card { flex:1 1 8rem; padding:.85rem 1rem; background:rgba(255,255,255,.42);
          border:1px solid rgba(26,18,10,.18); border-radius:2px; }
  .card b { display:block; font-size:1.6rem; line-height:1.1; }
  .card span { font-size:.75rem; letter-spacing:.1em; text-transform:uppercase;
               color:var(--soft); }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.9rem;
          background:rgba(255,255,255,.42); }
  th,td { padding:.5rem .7rem; text-align:left; white-space:nowrap;
          border-bottom:1px solid rgba(26,18,10,.14); }
  th { font-size:.72rem; letter-spacing:.1em; text-transform:uppercase;
       color:var(--soft); font-weight:400; }
  td.num, th.num { text-align:right; }
  code { font-family:'Courier New',monospace; letter-spacing:.08em; }
  tr.zero td { color:#8a7a63; }
  .off { color:#8c2f22; font-size:.75rem; }
  .foot { margin-top:2.5rem; font-size:.8rem; color:var(--soft); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Acessos aos materiais de Hybris</h1>
  <p class="sub">Atualizado em ${esc(shortDate(new Date().toISOString()))} UTC</p>

  <div class="cards">
    <div class="card"><b>${totalDownloads}</b><span>downloads</span></div>
    <div class="card"><b>${usados}/${rows.length}</b><span>códigos usados</span></div>
    <div class="card"><b>${rows.length - usados}</b><span>nunca abertos</span></div>
    <div class="card"><b>${invalid?.n ?? 0}</b><span>tentativas inválidas</span></div>
  </div>

  <h2>Por arquivo</h2>
  <div class="scroll"><table>
    <tr><th>Arquivo</th><th class="num">Downloads</th><th class="num">Pessoas</th></tr>
    ${fileStats
      .map(
        (f) => `<tr class="${f.downloads === 0 ? 'zero' : ''}">
      <td>${esc(f.title)}</td><td class="num">${f.downloads}</td><td class="num">${f.pessoas}</td></tr>`
      )
      .join('')}
  </table></div>

  <h2>Por código</h2>
  <div class="scroll"><table>
    <tr><th>Convidado</th><th>Código</th><th class="num">Downloads</th>
        <th class="num">Arquivos</th><th>Último acesso</th></tr>
    ${rows
      .map(
        (r) => `<tr class="${r.downloads === 0 ? 'zero' : ''}">
      <td>${esc(r.label)}${r.active ? '' : ' <span class="off">revogado</span>'}</td>
      <td><code>${esc(r.code.slice(0, 4))}-${esc(r.code.slice(4))}</code></td>
      <td class="num">${r.downloads}</td>
      <td class="num">${r.arquivos}/${FILES.length}</td>
      <td>${esc(shortDate(r.ultimo))}</td></tr>`
      )
      .join('')}
  </table></div>

  <p class="foot">Esta página mostra os códigos em claro. Não compartilhe a URL.</p>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      // A URL é o segredo; sem isto ela viajaria no Referer para qualquer link
      // que alguém clicasse a partir daqui.
      'Referrer-Policy': 'no-referrer',
    },
  });
};
