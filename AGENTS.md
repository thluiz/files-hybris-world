# AGENTS.md — guide for agents working in this repository

Working reference for any agent (Claude Code or other) that will touch this
repo. Read before editing.

## What this project is

Controlled delivery of Metron Showrunners materials — one deployment serving
the whole slate, one domain per property (`files.hybris.world` for Hybris).
PDFs in a **private** R2 bucket; whoever has a valid code downloads, and every
access is logged.

Static Astro 4 + **one** root middleware that resolves host → property +
**one** download Pages Function + **one** stats Function. No SSR, no UI
framework, no Tailwind. If you're about to add a dependency, re-read this
sentence.

```
(any request)         functions/_middleware.ts resolves the property from the
                      host and rewrites onto that property's page tree
GET  /d/<slug>        static page with the code form
POST /api/download    validates against D1 → checks the level → writes to access_log
                      → streams from R2
GET  /stats/<token>   access panel for the whole slate (the token is the credential)
```

**Properties.** `shared/properties.ts` describes each IP: hosts, copy, R2 key
prefix, palette. The build emits one page tree per property (`dist/hybris/…`)
because a static build can't emit two different `/index.html`; the middleware
maps the host onto the right tree, so the public URLs stay `/` and `/d/<slug>`
on every domain and the prefix never reaches the browser.

**Historical names.** The Pages project (`files-hybris-world`), the D1 database
and the R2 bucket (both `hybris-files`) are named after the first property.
They serve the whole slate now. Do not rename them: renaming the Pages project
drops the custom domain and the workflow's `--project-name`, and renaming the
D1 changes its id.

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
| ditto | a valid code from **another property** answers exactly like an invalid one (`?erro=1`, `ok = 0`) | the property is in the `WHERE`, so a foreign code finds no row — nothing tells the person that the code is real somewhere else |
| ditto | the slug is resolved with `fileFor(property, slug)` **before** any query | a slug from another property dies at the router, with no timing or log signal separating "exists elsewhere" from "doesn't exist" |
| ditto | the 10-per-15-min brake is **global**, not per property | otherwise switching hosts buys a fresh budget of ten |
| `functions/_middleware.ts` | the internal prefix (`/hybris/…`) returns 404 on production hosts | those pages are real objects in the deployment; without the rule, one property's domain serves another's pages |
| ditto | it is the only caller of `propertyForHost` — the Functions read `context.data.property` | two resolvers is how the same question gets two answers |
| ditto | an unknown host gets 404, never a fallback property | exact host match only; no suffix matching, no wildcards |
| `public/_routes.json` | `/_astro/*`, `/fonts/*` and the favicon skip the Worker | they're served straight from the edge, which means they **cannot** be host-gated — nothing under them may become property-secret |
| `shared/files.ts` | `canAccess()` is the single authorization rule | rewriting the comparison in another file is how `>=` turns into `>` without anyone noticing |
| ditto | `fileFor(property, slug)` is the only slug lookup; there's deliberately no property-free variant | slugs collide across properties, and a lookup that forgets the property is how one IP's code opens another's file |
| `db/schema.sql` | `codes.property` has **no** DEFAULT | `level` fails closed (0 opens nothing); a guessed property would fail open. An INSERT that forgets it must abort |
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
shared/properties.ts     One record per IP: slug, hosts, copy, R2 prefix,
                         palette. Adding a property means editing this array
                         and adding its block to global.css.
shared/files.ts          Catalog of the files: property, slug, title, level,
                         r2Key, download name, plus the levels and `canAccess()`.
                         SINGLE SOURCE OF TRUTH — imported by both the pages
                         and the Functions. Adding a file means editing
                         only this array.
functions/
  _middleware.ts         Host → property, and the rewrite onto that property's
                         page tree. The only caller of `propertyForHost`.
  api/download.ts        Validation, level check, logging, and streaming from R2.
  stats/[token].ts       Access panel for the whole slate, grouped by property
                         then level (HTML in TS).
src/
  pages/[property]/           index.astro and d/[slug].astro, via getStaticPaths
                              over the properties. Public URLs stay `/` and
                              `/d/<slug>` — the prefix is internal.
  layouts/Layout.astro   <head>, noindex, `data-property` on the body.
  styles/global.css      Plain CSS. `:root` is the default palette; one
                         `[data-property='x']` block per additional property.
public/_routes.json      What skips the Worker. See the security table.
db/
  schema.sql             `codes` and `access_log` tables. Idempotent. Describes
                         the database as it is today; used to create it from scratch.
  migrations/*.sql       Changes to an existing database. Each one runs ONCE.
  stats.sql              Read queries (`npm run stats`).
scripts/gen-codes.mjs    Code generator (`--property=<slug>` required,
                         `--level=N`, or level per line in db/labels.txt).
                         Duplicates the level list because it's .mjs and doesn't
                         import the .ts — changed there, change here.
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
   script reading `location.search`. The trailing-slash 308 is **ours**, in
   `_middleware.ts`, not Cloudflare's: after the rewrite, the automatic one
   would be computed on the internal path and leak `/hybris/…` into the
   address bar. If you touch the routing, test it again.

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

1. Upload the PDF under the property's prefix:
   `wrangler r2 object put hybris-files/<property>/<key> --file="..." --content-type=application/pdf`
2. Edit **only** `shared/files.ts` — the pages, the Function, and the panel
   follow automatically. The new file's `level` decides who can already open
   it: setting level 10 unlocks the material for all existing codes **of that
   property** at once.
3. `npm run build` and deploy.

## Adding a property

1. Add the record to `shared/properties.ts` (slug, hosts, copy, `r2Prefix`,
   `themeColor`) and a `[data-property='<slug>']` block to `global.css`.
2. Upload its PDFs under `<slug>/` in R2 and add the entries to `FILES`.
3. `node scripts/gen-codes.mjs --property=<slug>` then `npm run db:seed`.
   Check the count landed: `SELECT property, COUNT(*) FROM codes GROUP BY 1`
   — `INSERT OR IGNORE` drops a code that collides with an existing one
   silently, leaving a line in the CSV that isn't in the database.
4. Add the custom domain in the Pages dashboard (wrangler 3 can't).

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
4. No reference to a file or bucket in the public HTML, no internal prefix in
   the emitted links, and no bleed between the property trees. (`hybris/` on
   its own is now a legitimate build directory name — match the object-key
   shape instead.)
   ```bash
   grep -rniE 'r2key|\.pdf|(hybris|ned)/[0-9]' dist/                # must be empty
   grep -rniE 'href="/(hybris|ned)/|action="/(hybris|ned)/' dist/   # must be empty
   grep -rli 'not even death' dist/hybris/                          # must be empty
   ```
5. Tested in mobile viewport — whoever receives this link usually opens it on
   a phone.
6. If you touched the download flow, tested valid **and** invalid code
   against the deploy — and, with more than one property live, the tenancy
   test: a **valid code of property A sent to property B's host** must answer
   exactly like an invalid one (303 → `?erro=1`, never `?erro=nivel`, never
   200). That failure mode returns a real PDF and looks like success, so it's
   the one worth checking by hand every time.
7. If you touched the routing, checked that the internal prefix is not a
   public URL on a production host:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://files.hybris.world/hybris/   # 404
   ```
8. Commit message **without** a co-authorship trailer.
