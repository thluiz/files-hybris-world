# Backup

Three things here exist in exactly one place, and losing any of them is not
recoverable by rebuilding:

| What | Where it lives | Changes |
|---|---|---|
| `codes` and `access_log` | D1 `hybris-files` | every access, every block, every seed |
| `db/codes.csv` | this machine only — it is **not** in git | when codes are generated |
| the PDFs | R2 `hybris-files`, private bucket | only on a deliberate `r2 object put` |

The first two are backed up daily and unattended. The PDFs are not, on
purpose — see below.

## Daily, automatic

[`scripts/backup-d1.ps1`](scripts/backup-d1.ps1), run by Task Scheduler as
`\Claude\Hybris-Backup`, every day at 03:00, into `%OneDrive%\Hybris`:

```
Hybris\
  LAST-BACKUP.txt        OK/FAILED + timestamp. Not recent? the task stopped.
  db\<YYYY-MM-DD>\       d1-hybris-files.sql + codes.csv — last 5 days
  db\monthly\            one dump per month, never rotated
  codes-history\         one copy per distinct codes.csv content, never rotated
  r2\                    the PDFs, refreshed by hand
  _tools\backup.log
```

Run it by hand with `pwsh -NoProfile -File scripts/backup-d1.ps1`; `-Root`,
`-Repo` and `-KeepDays` are parameters.

Three guards in the script, each from something that actually went wrong:

- **The dump is validated before the rotation runs.** It must carry both
  `CREATE TABLE`s and a non-zero count of `INSERT INTO codes`. A failure today
  therefore never deletes the good days — nothing is rotated unless the new
  backup is known good.
- **`codes-history\` sits outside the 5-day window.** `gen-codes --force`
  overwrites `db/codes.csv`, and a week of rotation would carry the previous
  list out of every copy. Each distinct version is kept forever, 5 KB apiece.
- **The D1 export is retried 3×.** Wrangler authenticates with an OAuth token
  and occasionally returns `Authentication error [code: 10000]` while
  refreshing it.

## The PDFs, by hand

They are ~144 MB and only change when someone deliberately replaces one.
Wrangler 3 has no `r2 object head` and no `r2 object list`, so there is no way
to tell whether an object changed without downloading all of it — a daily job
would move 144 MB every night to learn nothing. **After replacing any PDF in
R2, refresh the copy:**

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<account id — see README>'
npx wrangler r2 object get hybris-files/hybris/01-one-pager.pdf `
  --file="$env:OneDrive\Hybris\r2\hybris_01-one-pager.pdf"
```

Do **not** pipe wrangler into `Select-Object -First` — that cmdlet closes the
pipeline, killing the download midway and leaving a truncated file with no
error. Two of the four PDFs came back as 0 bytes exactly this way. Check the
size afterwards.

Restoring is `r2 object put` with the same key and
`--content-type=application/pdf`.

## What cannot be backed up

`IP_SALT` and `STATS_TOKEN` are Cloudflare Pages secrets — write-only, there is
no export.

- `STATS_TOKEN`: generate a new one and publish it. The panel URL changes; that
  is all.
- `IP_SALT`: **do not rotate it casually.** Every `ip_hash` already in
  `access_log` was computed with it. A new salt breaks the continuity of the
  history and the brute-force brake stops recognising visitors it had already
  seen.

## Restoring the database

```bash
wrangler d1 execute hybris-files --remote --file=<dump>.sql
```

The dumps are full exports: schema plus rows. Test against `--local` first if
the dump is old enough that the schema may have moved since.
