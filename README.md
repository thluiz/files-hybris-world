# files.hybris.world

Controlled delivery of **Hybris** (Metron Showrunners) materials. Each file
has an access page; whoever has a valid code can download it, and every
access is logged for statistics.

The PDFs live in a private **R2 bucket** — there is no public URL for them.
The file only goes out via `POST /api/download`, after the code is validated.

## How it works

```
GET  /d/<slug>        static page with the code form
POST /api/download    Pages Function:
                        1. validates the code against D1
                        2. checks whether its level reaches the file
                        3. logs the event in access_log
                        4. reads the object from R2 and returns the stream
                      invalid code → 303 to /d/<slug>?erro=1
                      insufficient level → 303 to /d/<slug>?erro=nivel
```

The 4 files, their slugs and their levels live in
[`shared/files.ts`](shared/files.ts) — it's the single source of truth,
imported by both the pages and the Functions.

| Level | Slug | File |
|---|---|---|
| 10 | `one-pager` | Hybris — One-Pager |
| 20 | `pitch-deck` | Hybris — Pitch Deck |
| 30 | `series-bible` | Hybris — Series Bible |
| 40 | `season-one-script` | Hybris — Season One Full Script |

## Access levels

Each code carries a level and unlocks **every file at that level or below**.
The ladder mirrors the order in which the material is meant to be exposed:
the one-pager is shown to any interested party, the full script to almost
no one.

| Level | Unlocks |
|---|---|
| 0 | nothing — this is how a code gets blocked |
| 10 | One-Pager |
| 20 | One-Pager, Pitch Deck |
| 30 | One-Pager, Pitch Deck, Series Bible |
| 40 | all four |

Level 0 replaced the `active` column: blocking a code means zeroing its
level. The code stays in the table, and its history in `access_log` keeps
making sense. Jumps of 10 leave room for an intermediate level in the future
without renumbering what's already been distributed.

A legitimate code blocked by level is logged with `ok = 2`, separate from
invalid attempts (`ok = 0`): it isn't a leaked code, it's someone requesting
material they weren't given. That's also why it does **not** count toward
the brute-force throttle — someone with a code from the list shouldn't get
locked out for knocking on a door that isn't theirs.

Anyone who types a level-0 code sees the same invalid-code message: there's
no reason to reveal that the code ever existed.

## Stack

- Astro 4, static output (no SSR)
- Cloudflare Pages + Pages Functions
- R2 (files) and D1 (codes + log)

## The Cloudflare account

Everything lives in the `Watchyourhybris@gmail.com's Account` account
(`e8a97d34c66d7538dddf6603cf0089ee`) — the same one as the `hybris.world`
zone and the two Metron hotsites.

Pages config **does not accept** `account_id` in `wrangler.toml`, and the
credential sees more than one account. So every local command needs the
variable:

```bash
export CLOUDFLARE_ACCOUNT_ID=e8a97d34c66d7538dddf6603cf0089ee   # bash
$env:CLOUDFLARE_ACCOUNT_ID = 'e8a97d34c66d7538dddf6603cf0089ee' # pwsh
```

Without it, wrangler stops with *"More than one account available"*.

## Initial setup

Already done, documented here for rebuilding. Requires `wrangler login`.

```bash
# 1. Database — copy the returned database_id into wrangler.toml
wrangler d1 create hybris-files
npm run db:init

# 2. Access codes
npm run gen:codes
npm run db:seed

# 3. Pages project and secret
wrangler pages project create files-hybris-world --production-branch=main
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" \
  | wrangler pages secret put IP_SALT --project-name=files-hybris-world

# 4. Private bucket and PDF upload — requires R2 enabled on the account
wrangler r2 bucket create hybris-files
wrangler r2 object put hybris-files/hybris/01-one-pager.pdf              --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/02-pitch-deck.pdf             --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/03-series-bible.pdf           --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/04-season-one-full-script.pdf --file="..." --content-type=application/pdf
```

### Migrations

`db/schema.sql` describes the database as it stands today and serves to
create it from scratch. An existing database changes via files in
`db/migrations/`, each run **exactly once**:

The swap of `codes.active` for `codes.level` ships in three files, and
**order matters**: between the migration and the deploy there's a live
version of the site still reading the old column.

```bash
# 1. BEFORE the deploy — additive only. Every active code becomes level 40,
#    which is exactly the access it already had. The current site keeps working.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-access-levels.sql

# 2. Splits the 100 generic codes into four bands of 25 (10/20/30/40).
#    Codes zeroed out on purpose stay zeroed.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-split-existing-levels.sql

# 3. AFTER the deploy, with the new site tested: drops the old column.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-drop-active.sql
```

The `DB` and `FILES` bindings are **not** configured in the dashboard: they
live in [`wrangler.toml`](wrangler.toml) and are applied by the deploy
itself, thanks to the `pages_build_output_dir` field. Change a binding, just
publish again.

`IP_SALT` is the exception — a secret doesn't go into a versioned file, it
goes through `wrangler pages secret put` (once for `production`, once more
with `--env=preview`).

Still missing, in the dashboard: the custom domain `files.hybris.world`
(Pages project → *Custom domains*), which wrangler 3 can't create. And, on
GitHub, the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Development

```bash
npm install
npm run dev      # pages only; /api/download doesn't respond in this mode
npm run build
npm run preview  # dist/ + Functions + local bindings — this is where you test the download
```

For `preview` to work, create a `.dev.vars` (outside git) with:

```
IP_SALT=qualquer-coisa-para-teste
```

and populate the local database with `npm run db:init:local` and
`npm run db:seed:local`.

## Access codes

- 8 characters from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `I`,
  `O`, `0`, `1`, which get confused when someone types from an email).
- Generated with `randomInt` from `node:crypto`.
- A code unlocks files up to its **level**, as many times as needed.
- Accepts input with hyphens, spaces, or lowercase — the Function normalizes it.

```bash
npm run gen:codes                    # 100 level-10 codes
node scripts/gen-codes.mjs 40 --level=30
```

With `db/labels.txt` (one label per line), codes come out named, and the
level can be given per line — `--level` applies to the ones that don't
bring their own:

```
Ana Souza, 40
Producer X, 20
Festival contact
```

The default is the lowest level on purpose: raising a code later is an
`UPDATE`; pulling back material that's already been downloaded is not.

**`db/codes.csv`, `db/seed-codes.sql` and `db/labels.txt` are in
`.gitignore` and must never be committed — this repository is public.**
Keep the CSV somewhere safe; it's your only copy of the code ↔ person ↔
level mapping.

To block a code, or change its level:

```bash
wrangler d1 execute hybris-files --remote \
  --command="UPDATE codes SET level = 0  WHERE code = 'XXXXXXXX'"   # block
wrangler d1 execute hybris-files --remote \
  --command="UPDATE codes SET level = 30 WHERE code = 'XXXXXXXX'"   # promote
```

The change takes effect on the next access: the level is read on every
`POST`, there's no session or cache in between.

## Statistics

### Browser dashboard

```
https://files.hybris.world/stats/<STATS_TOKEN>
```

Shows the totals, downloads per file, and codes **grouped by access
level** — each group states which files that level unlocks, and lists how
many downloads, how many of those files, and the last access for each code.
Codes that were never used appear dimmed; the level-0 (blocked) group only
shows up when there's someone in it.

Each group collapses into an accordion, with shortcuts to expand or
collapse all. The HTML comes from the server with everything open, and it's
the script that collapses it on load: without JavaScript the page stays
whole and legible, it just doesn't collapse.

**The URL is the credential.** The expected token lives in the `STATS_TOKEN`
secret, never in code — this repository is public. A wrong token returns
`404`, not `403`, so as not to confirm the path exists.

Since the page lists codes in plaintext, it responds with `no-store`,
`noindex`, and `Referrer-Policy: no-referrer` — without that last one, the
secret URL would travel in the `Referer` header of any link clicked from it.

The token's entropy is the main defense, but not the only one: every wrong
token is logged with `ok = 3` (the sentinel slug `__stats__`) and, after 10
errors per IP in 15 minutes, the IP gets locked out. The lockout also
returns `404`, so as not to confirm the route exists even when the throttle
is active.

To rotate the token:

```bash
printf 'NOVO_TOKEN' | wrangler pages secret put STATS_TOKEN --project-name=files-hybris-world
```

### From the command line

```bash
npm run stats
```

Runs the queries in [`db/stats.sql`](db/stats.sql): downloads per file, who
downloaded what, delivered codes that were never used, how many codes exist
at each level, invalid attempts per day, and who hit a file above their own
level.

The log stores the `label` as copied at the moment of access, so revoking or
renaming a code later doesn't rewrite the history. Invalid attempts are also
logged — that's what exposes a code circulating outside the list.

We don't store the IP: the `ip_hash` field is `SHA-256(IP_SALT + IP)`,
enough to group a given visitor and support the brute-force throttle (10
invalid attempts per IP every 15 minutes).

## Security

Access-control analysis (2026-08-11). The question: is there any way to get
the files without a registered code?

By the application's logic, no. What holds it together:

- The R2 object is never exposed: it goes out as a stream via
  `POST /api/download`, with no public URL and no signed redirect.
- **The `hybris-files` bucket is private** (verified). The `r2Key` values are
  predictable (`hybris/01-one-pager.pdf` … `04-…`) and this repository is
  public, so a public bucket would hand everything over directly. It has to
  stay private: before any change to R2, reconfirm that there's no *Public
  access (r2.dev)* and no custom domain pointing at the bucket.
- SQL is always parameterized (no injection). The `slug` comes from
  `FILE_BY_SLUG`, never straight into the query.
- `Cache-Control: private, no-store` on the download prevents the Cloudflare
  edge from serving the file to anyone who didn't enter a code.
- Default level 0 (fail-closed): an `INSERT` that forgets the column
  unlocks nothing.
- Codes use `crypto.randomInt`, ~40 bits of entropy (32⁸). It's that entropy
  that holds off brute force, not the throttle of 10 attempts per IP every
  15 minutes: that throttle keys off `ip_hash`, and an attacker rotating IPs
  ignores it.

### Pending hardening

In order of return:

1. **Preview shares production.** `env.preview` in `wrangler.toml` points
   at the same D1 and the same R2. Preview deployments
   (`<hash>.files-hybris-world.pages.dev`) are public by default, so the
   real files are reachable through them with the real codes. Turn on
   **Cloudflare Access** on previews, or point preview at a disposable
   bucket/DB.
2. **The `/stats` URL is a master key.** It lists every code in plaintext
   and never expires. Guessing the token already has a throttle (10 errors
   per IP in 15 min, `ok = 3`), but the throttle doesn't protect against the
   correct URL leaking: if it gets out, every code goes with it, without any
   alarm. Keep `STATS_TOKEN` at ≥32 random characters and consider masking
   the codes in the dashboard (only the last few digits).
3. **Two bugs in the access system** (not vulnerabilities, but they break
   functionality):
   - `scripts/gen-codes.mjs` still does an `INSERT` with the `active`
     column, removed in the `2026-08-11-access-levels.sql` migration, so
     seeding new codes fails. Swap it for `level`.
   - `functions/stats/[token].ts` references `r.active` (doesn't exist), so
     every row in the dashboard shows up as "revoked". It should be
     `r.level <= 0`.
4. **`account_id` is versioned.** Not a secret, but in a public repo it
   hands a targeted attacker the exact account, project, and names.

## Deploy

A push to `main` triggers `.github/workflows/deploy.yml`, which builds
Astro and publishes to Cloudflare Pages.

Two details of the workflow that look superfluous and aren't:

- The deploy job runs `actions/checkout` **on purpose**: wrangler compiles
  `functions/` from the current directory, and the artifact only carries
  `dist/`. Without the checkout, the site would go up without the Function
  and every download would break with a 405.
- `pages deploy` runs **with no directory argument**. The directory comes
  from `pages_build_output_dir`; passing both is a validation error.
