/**
 * GET /stats/<token>
 *
 * Tracking panel: who downloaded what, how many times, and which codes
 * haven't been used yet.
 *
 * The URL is the credential. The expected token lives in the STATS_TOKEN
 * secret — never in the code, because this repository is public. A wrong
 * token returns 404, not 403: a guesser doesn't find out the path exists.
 *
 * This page lists the codes in plain text. If it leaks, everything leaks —
 * hence the noindex, the no-store, and the generic 404 response.
 */
import { ACCESS_LEVELS, FILES, filesForLevel, levelSummary } from '../../shared/files';

export interface Env {
  DB: D1Database;
  STATS_TOKEN: string;
  /** Same secret as the download flow: hashes the IP before logging the attempt. */
  IP_SALT: string;
}

/**
 * Brute-force brake on the token.
 *
 * The panel's real defense is still the entropy of `STATS_TOKEN`; this brake
 * is the safety net in case the token is weak. Since the page never logs a
 * success, every failed attempt is, in practice, someone guessing: we record
 * it as `ok = 3` — separate from invalid codes (`ok = 0`), so it doesn't
 * inflate the panel's counter — and lock the IP out after MAX_TOKEN_ATTEMPTS
 * errors within the window. The token only ever arrives copy-pasted, so a
 * legitimate human doesn't rack up errors.
 */
const MAX_TOKEN_ATTEMPTS = 10;
const TOKEN_WINDOW_MINUTES = 15;
const LOG_TOKEN_ATTEMPT = 3;
/** Sentinel slug: a token attempt isn't about any file. */
const STATS_SLUG = '__stats__';

/** Non-shortcutting comparison, so the token can't be discovered byte by byte. */
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
 * Denominator of the "Files" column: how many the level unlocks.
 *
 * At level 0 there's no denominator — whatever that code downloaded, it
 * downloaded before being blocked, and dividing by zero files wouldn't say
 * anything.
 */
function scopeOf(level: number): string {
  const n = filesForLevel(level).length;
  return n > 0 ? `/${n}` : '';
}

/** "2026-08-11T02:31:07.123Z" -> "11/08 02:31" */
function shortDate(ts: string | null): string {
  if (!ts) return '—';
  return `${ts.slice(8, 10)}/${ts.slice(5, 7)} ${ts.slice(11, 16)}`;
}

interface CodeRow {
  label: string;
  code: string;
  level: number;
  downloads: number;
  files: number;
  last: string | null;
}

interface FileRow {
  slug: string;
  downloads: number;
  people: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const token = String(params.token ?? '');
  const notFound = new Response('Not found', { status: 404 });

  // Brake before even looking at the token. Still returns 404 (never 429)
  // even when locked out: a 429 would confirm the route exists, which is
  // exactly what the 404 hides.
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
    // Logs the failure for the brake. Since the brake stops counting past the
    // ceiling, the log doesn't grow unbounded during a sustained attack.
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
              COUNT(DISTINCT a.slug)  AS files,
              MAX(a.ts)               AS last
       FROM codes c
       LEFT JOIN access_log a ON a.code = c.code AND a.ok = 1
       GROUP BY c.code
       ORDER BY downloads DESC, c.label ASC`
    ).all<CodeRow>(),
    env.DB.prepare(
      `SELECT slug, COUNT(*) AS downloads, COUNT(DISTINCT code) AS people
       FROM access_log WHERE ok = 1
       GROUP BY slug`
    ).all<FileRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM access_log WHERE ok = 0`
    ).first<{ n: number }>(),
    // Valid code blocked by level: not a leaked code, it's someone requesting
    // material that wasn't released to them.
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM access_log WHERE ok = 2`
    ).first<{ n: number }>(),
  ]);

  const rows = codes.results ?? [];
  const used = rows.filter((r) => r.downloads > 0).length;
  const totalDownloads = rows.reduce((sum, r) => sum + r.downloads, 0);
  const blocked = rows.filter((r) => r.level <= 0).length;

  // Sorted by the catalog, not by whatever the database returned: a file with
  // zero downloads still needs to show up in the table as zero, not vanish
  // from it.
  const fileStats = FILES.map((f) => {
    const hit = (byFile.results ?? []).find((b) => b.slug === f.slug);
    return {
      title: f.title,
      level: f.level,
      downloads: hit?.downloads ?? 0,
      people: hit?.people ?? 0,
    };
  });

  // One group per catalog level, in ladder order. A code with a level outside
  // the list (typed by hand in an UPDATE) can't just disappear from the panel
  // — it gets its own group, at the end, where it stands out.
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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Access — Hybris</title>
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
  .warn { margin:0 0 2rem; padding:.9rem 1.1rem; background:rgba(140,47,34,.1);
          border:1px solid #8c2f22; border-left-width:4px; border-radius:2px;
          color:#8c2f22; font-size:.9rem; }
  .warn b { letter-spacing:.02em; }
  .level { margin-bottom:1.75rem; }
  /* Button because the header is clickable: keyboard and screen-reader support
     come for free. The reset below undoes the button's appearance, not its
     behavior. */
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
  .level.unknown .level-head b::after { content:' (out of range)'; font-size:.75rem;
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
  <p class="warn">
    <b>This page shows the codes in plain text.</b><br />
    Whoever has this URL has every code, and it is the only credential.<br />
    <b>Do not share the URL</b> — not as a screenshot, not as a link, not pasted into a conversation.
  </p>

  <h1>Access to Hybris materials</h1>
  <p class="sub">Updated at ${esc(shortDate(new Date().toISOString()))} UTC</p>

  <div class="cards">
    <div class="card"><b>${totalDownloads}</b><span>downloads</span></div>
    <div class="card"><b>${used}/${rows.length}</b><span>codes used</span></div>
    <div class="card"><b>${rows.length - used}</b><span>never opened</span></div>
    <div class="card"><b>${blocked}</b><span>blocked (level 0)</span></div>
    <div class="card"><b>${invalid?.n ?? 0}</b><span>invalid attempts</span></div>
    <div class="card"><b>${denied?.n ?? 0}</b><span>denied by level</span></div>
  </div>

  <h2>By file</h2>
  <div class="scroll"><table>
    <tr><th>File</th><th class="num">Level</th><th class="num">Downloads</th>
        <th class="num">People</th></tr>
    ${fileStats
      .map(
        (f) => `<tr class="${f.downloads === 0 ? 'zero' : ''}">
      <td>${esc(f.title)}</td><td class="num">${f.level}</td>
      <td class="num">${f.downloads}</td><td class="num">${f.people}</td></tr>`
      )
      .join('')}
  </table></div>

  <h2>By access level</h2>
  <div class="toolbar" id="toolbar" hidden>
    <button type="button" data-all="open">Expand all</button>
    <button type="button" data-all="close">Collapse all</button>
  </div>
  ${groups
    .filter((g) => g.codes.length > 0 || (g.known && g.level > 0))
    .map(
      (g) => `<div class="level${g.level <= 0 ? ' blocked' : ''}${g.known ? '' : ' unknown'}">
    <button type="button" class="level-head" aria-expanded="true" aria-controls="nivel-${g.level}">
      <span class="caret" aria-hidden="true">▾</span>
      <b>Level ${g.level}</b>
      <span class="abre">${g.level <= 0 ? 'opens nothing' : `opens ${esc(g.abre)}`}</span>
      <span class="count">${g.codes.length} ${g.codes.length === 1 ? 'code' : 'codes'}</span>
    </button>
    <div class="level-body" id="nivel-${g.level}">
    ${
      g.codes.length === 0
        ? '<p class="empty">No codes at this level.</p>'
        : `<div class="scroll"><table>
      <tr><th>Guest</th><th>Code</th><th class="num">Downloads</th>
          <th class="num">Files</th><th>Last access</th></tr>
      ${g.codes
        .map(
          (r) => `<tr class="${r.downloads === 0 ? 'zero' : ''}">
        <td>${esc(r.label)}</td>
        <td><code>${esc(r.code.slice(0, 4))}-${esc(r.code.slice(4))}</code></td>
        <td class="num">${r.downloads}</td>
        <td class="num">${r.files}${scopeOf(g.level)}</td>
        <td>${esc(shortDate(r.last))}</td></tr>`
        )
        .join('')}
    </table></div>`
    }
    </div>
  </div>`
    )
    .join('')}

</div>

<script>
// Level accordion. The HTML comes from the server with everything open on
// purpose: if this script doesn't run, the page stays whole and readable —
// it just doesn't collapse. The collapsing itself happens here, on load.
(function () {
  var heads = document.querySelectorAll('.level-head');
  if (!heads.length) return;

  function set(head, open) {
    head.setAttribute('aria-expanded', String(open));
    document.getElementById(head.getAttribute('aria-controls')).hidden = !open;
  }

  heads.forEach(function (head) {
    // Starts collapsed, except the level that has no one yet: there, what
    // matters is precisely the "no codes at this level" line.
    var empty = head.parentNode.querySelector('.empty') !== null;
    set(head, empty);
    head.addEventListener('click', function () {
      set(head, head.getAttribute('aria-expanded') !== 'true');
    });
  });

  // The two buttons only exist for users with script; without it they'd do
  // nothing.
  var toolbar = document.getElementById('toolbar');
  toolbar.hidden = false;
  toolbar.addEventListener('click', function (e) {
    var action = e.target.getAttribute('data-all');
    if (!action) return;
    heads.forEach(function (head) { set(head, action === 'open'); });
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
      // The URL is the secret; without this it would travel in the Referer to
      // any link someone clicked from here.
      'Referrer-Policy': 'no-referrer',
    },
  });
};
