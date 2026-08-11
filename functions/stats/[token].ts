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
import { ACCESS_LEVELS, FILES, filesForLevel, levelSummary } from '../../shared/files';

export interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
  /** Mesmo segredo do download: hasheia o IP antes de gravar a tentativa. */
  IP_SALT: string;
}

/**
 * Freio de força bruta no token.
 *
 * A defesa real do painel continua sendo a entropia do `STATS_TOKEN`; este
 * freio é a rede de segurança para o caso de o token ser fraco. Como a página
 * não registra acerto nenhum, toda tentativa que erra o token é, na prática,
 * alguém adivinhando: gravamos como `ok = 3` — separado das inválidas de código
 * (`ok = 0`), para não inflar o contador do painel — e trancamos o IP depois de
 * MAX_TOKEN_ATTEMPTS erros na janela. O token só chega copiado e colado, então
 * um humano legítimo não acumula erros.
 */
const MAX_TOKEN_ATTEMPTS = 10;
const TOKEN_WINDOW_MINUTES = 15;
const LOG_TOKEN_ATTEMPT = 3;
/** slug-sentinela: a tentativa de token não é sobre nenhum arquivo. */
const STATS_SLUG = '__stats__';

/** Comparação sem atalho de tempo, para o token não ser descoberto byte a byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Denominador da coluna "Arquivos": quantos o nível abre.
 *
 * No nível 0 não há denominador — o que aquele código baixou, baixou antes de
 * ser bloqueado, e dividir por zero arquivos não diria nada.
 */
function scopeOf(level: number): string {
  const n = filesForLevel(level).length;
  return n > 0 ? `/${n}` : '';
}

/** "2026-08-11T02:31:07.123Z" → "11/08 02:31" */
function shortDate(ts: string | null): string {
  if (!ts) return '—';
  return `${ts.slice(8, 10)}/${ts.slice(5, 7)} ${ts.slice(11, 16)}`;
}

interface CodeRow {
  label: string;
  code: string;
  level: number;
  downloads: number;
  arquivos: number;
  ultimo: string | null;
}

interface FileRow {
  slug: string;
  downloads: number;
  pessoas: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const token = String(params.token ?? '');
  const notFound = new Response('Not found', { status: 404 });

  // Freio antes de olhar o token. Continua devolvendo 404 (nunca 429) mesmo
  // trancado: um 429 confirmaria que a rota existe, que é justamente o que o
  // 404 esconde.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(ip, env.IP_SALT ?? 'no-salt-configured');
  const since = new Date(Date.now() - TOKEN_WINDOW_MINUTES * 60_000).toISOString();
  const failed = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM access_log WHERE ip_hash = ? AND ok = ? AND ts > ?`
  )
    .bind(ipHash, LOG_TOKEN_ATTEMPT, since)
    .first<{ n: number }>();

  if ((failed?.n ?? 0) >= MAX_TOKEN_ATTEMPTS) {
    return notFound;
  }

  if (!env.STATS_TOKEN || !safeEqual(token, env.STATS_TOKEN)) {
    // Registra o erro para o freio. Como o freio para de contar depois do teto,
    // o log não cresce sem limite durante um ataque sustentado.
    const country = (request as { cf?: { country?: string } }).cf?.country ?? null;
    const ua = request.headers.get('User-Agent')?.slice(0, 300) ?? null;
    await env.DB.prepare(
      `INSERT INTO access_log (code, label, slug, ok, ts, country, ip_hash, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(null, null, STATS_SLUG, LOG_TOKEN_ATTEMPT, new Date().toISOString(), country, ipHash, ua)
      .run();
    return notFound;
  }

  const [codes, byFile, invalid, denied] = await Promise.all([
    env.DB.prepare(
      `SELECT c.label, c.code, c.level,
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
    // Código válido barrado pelo nível: não é código vazado, é alguém pedindo
    // material que não foi liberado para ele.
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM access_log WHERE ok = 2`
    ).first<{ n: number }>(),
  ]);

  const rows = codes.results ?? [];
  const usados = rows.filter((r) => r.downloads > 0).length;
  const totalDownloads = rows.reduce((sum, r) => sum + r.downloads, 0);
  const bloqueados = rows.filter((r) => r.level <= 0).length;

  // Ordena pelo catálogo, não pelo que o banco devolveu: arquivo sem nenhum
  // download precisa aparecer na tabela como zero, não sumir dela.
  const fileStats = FILES.map((f) => {
    const hit = (byFile.results ?? []).find((b) => b.slug === f.slug);
    return {
      title: f.title,
      level: f.level,
      downloads: hit?.downloads ?? 0,
      pessoas: hit?.pessoas ?? 0,
    };
  });

  // Um grupo por nível do catálogo, na ordem da escada. Um código com nível
  // fora da lista (digitado à mão num UPDATE) não pode sumir do painel — vai
  // para um grupo próprio, no fim, onde salta aos olhos.
  const known = new Set<number>(ACCESS_LEVELS);
  const extras = [...new Set(rows.map((r) => r.level).filter((l) => !known.has(l)))].sort(
    (a, b) => a - b
  );
  const groups = [...ACCESS_LEVELS, ...extras].map((level) => ({
    level,
    known: known.has(level),
    abre: levelSummary(level),
    codes: rows.filter((r) => r.level === level),
  }));

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
  .warn { margin-top:2.5rem; padding:.9rem 1.1rem; background:rgba(140,47,34,.1);
          border:1px solid #8c2f22; border-left-width:4px; border-radius:2px;
          color:#8c2f22; font-size:.9rem; }
  .warn b { letter-spacing:.02em; }
  .level { margin-bottom:1.75rem; }
  /* Botão porque o cabeçalho é clicável: teclado e leitor de tela vêm de graça.
     O reset abaixo desfaz a aparência de botão, não o comportamento. */
  .level-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:.5rem .75rem;
                width:100%; padding:.35rem 0; border:0;
                border-bottom:2px solid rgba(26,18,10,.28);
                background:none; color:inherit; font:inherit; text-align:left;
                cursor:pointer; }
  .level-head:hover { background:rgba(255,255,255,.28); }
  .level-head:focus-visible { outline:2px solid var(--gold); outline-offset:2px; }
  .level-head b { font-size:1.05rem; }
  .level-head .abre { color:var(--soft); font-size:.85rem; font-style:italic; }
  .level-head .count { margin-left:auto; font-size:.75rem; letter-spacing:.1em;
                       text-transform:uppercase; color:var(--soft); }
  .caret { display:inline-block; width:.75rem; color:var(--soft);
           transition:transform .15s ease; }
  .level-head[aria-expanded="false"] .caret { transform:rotate(-90deg); }
  .level.blocked .level-head { border-bottom-color:#8c2f22; }
  .level.blocked .level-head b { color:#8c2f22; }
  .level.unknown .level-head b::after { content:' (fora da escala)'; font-size:.75rem;
                                        color:#8c2f22; font-weight:400; }
  .empty { margin:.6rem 0 0; font-size:.85rem; color:#8a7a63; font-style:italic; }
  .toolbar { display:flex; gap:.75rem; margin:-.35rem 0 1rem; }
  .toolbar button { border:1px solid rgba(26,18,10,.22); background:rgba(255,255,255,.42);
                    color:var(--soft); font:inherit; font-size:.75rem; letter-spacing:.1em;
                    text-transform:uppercase; padding:.3rem .7rem; border-radius:2px;
                    cursor:pointer; }
  .toolbar button:hover { background:rgba(255,255,255,.7); color:var(--ink); }
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
    <div class="card"><b>${bloqueados}</b><span>bloqueados (nível 0)</span></div>
    <div class="card"><b>${invalid?.n ?? 0}</b><span>tentativas inválidas</span></div>
    <div class="card"><b>${denied?.n ?? 0}</b><span>barrados por nível</span></div>
  </div>

  <h2>Por arquivo</h2>
  <div class="scroll"><table>
    <tr><th>Arquivo</th><th class="num">Nível</th><th class="num">Downloads</th>
        <th class="num">Pessoas</th></tr>
    ${fileStats
      .map(
        (f) => `<tr class="${f.downloads === 0 ? 'zero' : ''}">
      <td>${esc(f.title)}</td><td class="num">${f.level}</td>
      <td class="num">${f.downloads}</td><td class="num">${f.pessoas}</td></tr>`
      )
      .join('')}
  </table></div>

  <h2>Por nível de acesso</h2>
  <div class="toolbar" id="toolbar" hidden>
    <button type="button" data-all="open">Expandir tudo</button>
    <button type="button" data-all="close">Recolher tudo</button>
  </div>
  ${groups
    .filter((g) => g.codes.length > 0 || (g.known && g.level > 0))
    .map(
      (g) => `<div class="level${g.level <= 0 ? ' blocked' : ''}${g.known ? '' : ' unknown'}">
    <button type="button" class="level-head" aria-expanded="true" aria-controls="nivel-${g.level}">
      <span class="caret" aria-hidden="true">▾</span>
      <b>Nível ${g.level}</b>
      <span class="abre">${g.level <= 0 ? 'não abre nada' : `abre ${esc(g.abre)}`}</span>
      <span class="count">${g.codes.length} ${g.codes.length === 1 ? 'código' : 'códigos'}</span>
    </button>
    <div class="level-body" id="nivel-${g.level}">
    ${
      g.codes.length === 0
        ? '<p class="empty">Nenhum código neste nível.</p>'
        : `<div class="scroll"><table>
      <tr><th>Convidado</th><th>Código</th><th class="num">Downloads</th>
          <th class="num">Arquivos</th><th>Último acesso</th></tr>
      ${g.codes
        .map(
          (r) => `<tr class="${r.downloads === 0 ? 'zero' : ''}">
        <td>${esc(r.label)}</td>
        <td><code>${esc(r.code.slice(0, 4))}-${esc(r.code.slice(4))}</code></td>
        <td class="num">${r.downloads}</td>
        <td class="num">${r.arquivos}${scopeOf(g.level)}</td>
        <td>${esc(shortDate(r.ultimo))}</td></tr>`
        )
        .join('')}
    </table></div>`
    }
    </div>
  </div>`
    )
    .join('')}

  <p class="warn"><b>Esta página mostra os códigos em claro.</b> Quem tiver esta
    URL tem todos os códigos, e ela é a única credencial. <b>Não compartilhe a
    URL</b> — nem em print, nem em link, nem colada em conversa.</p>
</div>

<script>
// Accordion dos níveis. O HTML sai do servidor com tudo aberto de propósito:
// se este script não rodar, a página continua inteira e legível — só deixa de
// dobrar. Quem recolhe é o próprio script, no carregamento.
(function () {
  var heads = document.querySelectorAll('.level-head');
  if (!heads.length) return;

  function set(head, open) {
    head.setAttribute('aria-expanded', String(open));
    document.getElementById(head.getAttribute('aria-controls')).hidden = !open;
  }

  heads.forEach(function (head) {
    // Começa recolhido, menos o nível que ainda não tem ninguém: ali o que
    // interessa é justamente a linha "nenhum código neste nível".
    var vazio = head.parentNode.querySelector('.empty') !== null;
    set(head, vazio);
    head.addEventListener('click', function () {
      set(head, head.getAttribute('aria-expanded') !== 'true');
    });
  });

  // Os dois botões só existem para quem tem script; sem ele não fariam nada.
  var toolbar = document.getElementById('toolbar');
  toolbar.hidden = false;
  toolbar.addEventListener('click', function (e) {
    var acao = e.target.getAttribute('data-all');
    if (!acao) return;
    heads.forEach(function (head) { set(head, acao === 'open'); });
  });
})();
</script>
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
