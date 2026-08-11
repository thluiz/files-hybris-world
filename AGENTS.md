# AGENTS.md — guide for agents working in this repository

Working reference for any agent (Claude Code or other) that will touch this
repo. Read before editing.

## What this project is

Controlled delivery of **Hybris** (Metron Showrunners) materials, at
`files.hybris.world`. Four PDFs in a **private** R2 bucket; whoever has a
valid code downloads, and every access is logged.

Static Astro 4 + **one** download Pages Function + **one** stats Function.
No SSR, no UI framework, no Tailwind. If you're about to add a dependency,
re-read this sentence.

```
GET  /d/<slug>        static page with the code form
POST /api/download    validates against D1 → checks the level → writes to access_log
                      → streams from R2
GET  /stats/<token>   access panel (the token is the credential)
```

Each file has a **level** (10, 20, 30, 40, in order of material exposure)
and each code carries its own: it opens any file at an equal or lower level.
Level 0 opens nothing — that's how you block a code without deleting it.
The rule lives in `canAccess()`, in `shared/files.ts`, and must not be
rewritten from memory anywhere else.

This is **not** the hotsite. The hotsite (`metron-hotsite` /
`metron-hotsite-beta`) is a different repository, with a different promote
flow. Don't mix the two.

## Golden rule: this repository is public

Consequences that already nearly went wrong:

- **No access code goes into git.** `db/codes.csv`, `db/seed-codes.sql`
  and `db/labels.txt` are in `.gitignore`. If you generate codes, they stay
  out of version control — always.
- **No token goes into the code.** `STATS_TOKEN` lives as a Pages secret
  precisely because writing it into the source would hand the 100 codes to
  anyone who opened GitHub. Same rule for `IP_SALT`.
- **No PDF goes into git.** They live in R2. `.gitignore` has `*.pdf`.

Before committing, run the check in the *Checklist* section.

## The security model (what must not break)

Each item below exists for a specific reason. If you're going to touch it,
understand the reason first.

| Where | What | Why |
|---|---|---|
| `functions/api/download.ts` | `Cache-Control: private, no-store` on the file response | without this the Cloudflare edge could serve the PDF to someone who never entered a code |
| ditto | brake of 10 invalid attempts per IP every 15 min | 100 valid codes would be swept fast without this |
| ditto | an invalid attempt also becomes a row in `access_log` (`ok = 0`) | it's the signal that a code has leaked and is circulating |
| ditto | a code blocked by level is `ok = 2`, exempt from the brake | someone with a code from the list shouldn't get locked out for knocking on a door that isn't theirs; and the stats separate "asked too much" from "leaked code" |
| ditto | level 0 returns the same message as an invalid code | someone typing an already-blocked code doesn't need to know it ever existed |
| ditto | `label` copied into the log at the moment of access | revoking or renaming a code later doesn't rewrite history |
| ditto | IP stored only as `SHA-256(IP_SALT + IP)` | groups the visitor and supports the brake without retaining personal data in the clear |
| `shared/files.ts` | `canAccess()` is the single authorization rule | rewriting the comparison in another file is how `>=` turns into `>` without anyone noticing |
| `functions/stats/[token].ts` | wrong token returns **404**, not 403 | someone guessing doesn't find out the route exists |
| ditto | comparison without a timing shortcut | the token can't be discovered character by character |
| ditto | wrong token becomes `ok = 3` and locks the IP after 10 errors in 15 min | the token's entropy is the main defense, this is the safety net; it's kept separate from `ok = 0` so it doesn't inflate the invalid-codes counter |
| ditto | once locked, still responds **404** — never 429 | a 429 would confirm the route exists, which is what the 404 hides |
| ditto | `Referrer-Policy: no-referrer` | the URL **is** the secret; without this it leaks in the `Referer` of any link clicked from the page |
| `src/layouts/Layout.astro` | `noindex, nofollow` | restricted material can't show up in a search engine |

The R2 object path (`r2Key`) must never reach the HTML. There's a check for
this in the checklist.

## Where things live

```
shared/files.ts          Catalog of the 4 files: slug, title, level, r2Key,
                         download name, plus the levels and `canAccess()`.
                         SINGLE SOURCE OF TRUTH — imported by both the pages
                         and the Functions. Adding a file means editing
                         only this array.
functions/
  api/download.ts        Validation, level check, logging, and streaming from R2.
  stats/[token].ts       Access panel, grouped by level (HTML in TS).
src/
  pages/d/[slug].astro   The 4 code pages, via getStaticPaths.
  pages/index.astro      Neutral page; lists nothing.
  layouts/Layout.astro   <head>, noindex.
  styles/global.css      Plain CSS, palette inherited from Metron's key art.
db/
  schema.sql             `codes` and `access_log` tables. Idempotent. Describes
                         the database as it is today; used to create it from scratch.
  migrations/*.sql       Changes to an existing database. Each one runs ONCE.
  stats.sql              Read queries (`npm run stats`).
scripts/gen-codes.mjs    Code generator (`--level=N`, or level per line
                         in db/labels.txt). Duplicates the level list because it's
                         .mjs and doesn't import the .ts — changed there, change here.
wrangler.toml            D1 + R2 bindings, applied at deploy.
```

## Cloudflare Pages pitfalls (the ones that already cost time)

These aren't style preferences. Each one breaks the deploy or the site.

1. **`wrangler pages deploy` runs WITHOUT a directory argument.** The
   directory comes from `pages_build_output_dir` in `wrangler.toml`. Passing
   both is a validation error. It's this same field that makes the bindings
   (`DB`, `FILES`) get applied by the deploy instead of being configured by
   hand in the dashboard.

2. **Don't put `account_id` in `wrangler.toml`.** Pages config doesn't accept
   the field (only Workers config does). Since the credential sees more than
   one account, local commands need the variable:
   ```
   CLOUDFLARE_ACCOUNT_ID=e8a97d34c66d7538dddf6603cf0089ee
   ```
   Without it, wrangler stops with *"More than one account available"*.

3. **The `pages-deploy` job does `actions/checkout` on purpose.** Wrangler
   compiles `functions/` from the current directory, and the artifact only
   carries `dist/`. Without the checkout, the site goes up without the
   Functions and every download breaks with 405.

4. **The pages are static — there's no query string at build time.** The
   form's error message arrives via `?erro=1` and is revealed by an inline
   script reading `location.search`. Astro serves `/d/<slug>/` with a
   trailing slash and Cloudflare redirects with 308 preserving the query;
   this is tested, but if you touch the routing, test it again.

5. **`npm run dev` doesn't serve the Functions.** To test download or stats
   locally, use `npm run preview` (which is `wrangler pages dev dist`), with
   `.dev.vars` filled in.

## How to run and verify

```bash
npm install
npm run build     # ALWAYS before pushing
npm run preview   # dist/ + Functions + local bindings
```

Check that matters more than the build, because the build passes even with a
broken Function:

```bash
npx wrangler pages functions build --outfile=.wrangler/test-worker.js
```

And, after any change to `download.ts` or `shared/files.ts`, test **against
the real deploy** — valid code, invalid code, and the response header:

```bash
BASE=https://files-hybris-world.pages.dev
curl -s -o /dev/null -D - -X POST "$BASE/api/download" -d "slug=one-pager" -d "code=INVALIDO" | grep -iE '^HTTP|^location'
# expected: 303 -> /d/one-pager?erro=1
```

A test of yours writes a row to `access_log` and shows up in the panel. Clean
it up afterward if it's before distributing:

```bash
wrangler d1 execute hybris-files --remote --command="DELETE FROM access_log"
```

## Swapping or adding a file

1. Upload the PDF: `wrangler r2 object put hybris-files/hybris/<key> --file="..." --content-type=application/pdf`
2. Edit **only** `shared/files.ts` — the pages, the Function, and the panel
   follow automatically. The new file's `level` decides who can already open
   it: setting level 10 unlocks the material for all existing codes at once.
3. `npm run build` and deploy.

Swapping the content while keeping the same `r2Key`, there's no cache to
bust: the response is already `no-store`.

## Checklist before pushing

1. `npm run build` passed.
2. `npx wrangler pages functions build` compiled.
3. No code/secret in the diff:
   ```bash
   git ls-files | grep -E 'codes\.csv|seed-codes|labels\.txt|\.dev\.vars$|\.pdf'   # must come back empty
   git grep -nE 'oauth_token|api_token|STATS_TOKEN *= *["'\'']'                    # ditto
   ```
4. No reference to a file or bucket in the public HTML:
   ```bash
   grep -rniE 'r2key|\.pdf|hybris/' dist/    # must come back empty
   ```
5. Tested in mobile viewport — whoever receives this link usually opens it on
   a phone.
6. If you touched the download flow, tested valid **and** invalid code
   against the deploy.
7. Commit message **without** a co-authorship trailer.
