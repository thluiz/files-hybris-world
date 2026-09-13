# Daily backup of what changes daily: the D1 database and the code list.
#
# WHAT IS IN: the `hybris-files` D1 (access_log grows on every access, codes
# changes on every block, promotion or seed) and db/codes.csv, which is the
# only copy of the code <-> person <-> level mapping and is NOT in git.
#
# WHAT IS OUT: the PDFs in R2. They are ~144 MB that only change when someone
# deliberately runs `wrangler r2 object put`, and wrangler 3 has no `head` and
# no `list` — there is no way to tell whether an object changed without
# downloading all of it. They are backed up by hand; see BACKUP.md.
#
# Runs unattended from Task Scheduler (\Claude\Hybris-Backup):
#   pwsh -NoProfile -File "<repo>\scripts\backup-d1.ps1"
#
# Everything it writes lands in -Root. Nothing in this script is a secret:
# the account id is already documented in the README.

[CmdletBinding()]
param(
    # The repository. `wrangler` and `db/codes.csv` are read from here.
    [string] $Repo = (Split-Path $PSScriptRoot -Parent),

    # Where the backups go. Defaults to OneDrive, so they leave this machine.
    [string] $Root = (Join-Path $env:OneDrive 'Hybris'),

    # Dated folders kept under <Root>\db. The monthly snapshot and the
    # codes.csv history are NOT subject to this.
    [int] $KeepDays = 5,

    # The credential can see more than one account, so wrangler needs this or
    # it stops with "More than one account available". Not written here: this
    # repository is public, and there is no reason to add one more copy of it.
    # The scheduled task passes it; interactively, export it first. The value
    # is in the README.
    [string] $AccountId = $env:CLOUDFLARE_ACCOUNT_ID
)

$ErrorActionPreference = 'Stop'

if (-not $AccountId) {
    throw 'No account id: pass -AccountId or set CLOUDFLARE_ACCOUNT_ID (see README).'
}

$DbRoot = Join-Path $Root 'db'
$Today  = Get-Date -Format 'yyyy-MM-dd'
$Dest   = Join-Path $DbRoot $Today
$Log    = Join-Path $Root '_tools\backup.log'

$env:CLOUDFLARE_ACCOUNT_ID = $AccountId

function Write-Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $Log -Value $line -Encoding utf8
}

# Node comes from fnm, which only reaches PATH through a per-shell ephemeral
# directory (fnm_multishells\<pid>_<ts>) created by the user profile. Under
# Task Scheduler, and with -NoProfile, that directory does not exist and `npx`
# does not resolve — the task failed exactly this way the first time it was
# triggered for real. So: find node.exe by a stable path and call the repo's
# own wrangler directly, with no npx (which would also hit the registry).
function Resolve-NodeExe {
    $c = Get-Command node -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }

    $alias = Join-Path $env:APPDATA 'fnm\aliases\default\node.exe'
    if (Test-Path $alias) { return $alias }

    $versions = Get-ChildItem (Join-Path $env:APPDATA 'fnm\node-versions') -Directory -ErrorAction SilentlyContinue |
                Where-Object { Test-Path (Join-Path $_.FullName 'installation\node.exe') } |
                Sort-Object { [version]($_.Name.TrimStart('v')) } -Descending
    if ($versions) { return (Join-Path $versions[0].FullName 'installation\node.exe') }

    throw 'node.exe not found (neither on PATH nor under fnm)'
}

try {
    New-Item -ItemType Directory -Force -Path $Dest, (Split-Path $Log) | Out-Null
    Write-Log '=== start ==='

    # --- 1. D1 export -----------------------------------------------------
    # Wrangler's output goes to a file. NEVER pipe it into Select-Object
    # -First: that cmdlet closes the pipeline, which kills wrangler mid-run
    # and leaves a truncated file behind with no error at all.
    #
    # Wrangler authenticates with an OAuth token and occasionally answers
    # "Authentication error [code: 10000]" while refreshing it — seen on
    # 2026-09-13: failed once, passed a minute later untouched. An unattended
    # task must not lose the day's backup to that, hence the retry.
    $sql = Join-Path $Dest 'd1-hybris-files.sql'
    $out = Join-Path $Dest '_wrangler.log'

    $node = Resolve-NodeExe
    $wrangler = Join-Path $Repo 'node_modules\wrangler\bin\wrangler.js'
    if (-not (Test-Path $wrangler)) { throw "wrangler not found at $wrangler (npm install in the repo?)" }
    Write-Log ("node: {0}" -f $node)

    $code = 1
    foreach ($try in 1..3) {
        Push-Location $Repo
        try {
            & $node $wrangler d1 export hybris-files --remote --output="$sql" *> $out
            $code = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($code -eq 0) { break }
        Write-Log ("attempt {0}/3 failed (exit {1})" -f $try, $code)
        if ($try -lt 3) { Start-Sleep -Seconds 20 }
    }

    if ($code -ne 0)           { throw "wrangler d1 export failed 3x (exit $code, see $out)" }
    if (-not (Test-Path $sql)) { throw "wrangler produced no $sql" }

    # The dump must carry both tables AND rows. A file holding the schema and
    # zero INSERTs would pass for a backup and is not one.
    $dump      = Get-Content $sql -Raw
    $nCodes    = ([regex]::Matches($dump, 'INSERT INTO "?codes"?')).Count
    $nLog      = ([regex]::Matches($dump, 'INSERT INTO "?access_log"?')).Count
    $hasTables = ($dump -match 'CREATE TABLE .?codes') -and ($dump -match 'CREATE TABLE .?access_log')

    if (-not $hasTables) { throw 'dump has no CREATE TABLE for codes/access_log — discarded' }
    if ($nCodes -eq 0)   { throw 'dump has ZERO rows in codes — discarded' }

    Write-Log ('d1 export ok: {0} codes, {1} access_log, {2:N0} bytes' -f $nCodes, $nLog, (Get-Item $sql).Length)
    Remove-Item $out -ErrorAction SilentlyContinue

    # --- 2. codes.csv -----------------------------------------------------
    $csv = Join-Path $Repo 'db\codes.csv'
    if (Test-Path $csv) {
        Copy-Item $csv (Join-Path $Dest 'codes.csv') -Force
        Write-Log ('codes.csv copied ({0} lines)' -f (Get-Content $csv).Count)

        # Content-addressed history, OUTSIDE the rotation. The 5-day window has
        # a hole: `gen-codes --force` overwrites codes.csv, and if nobody
        # notices for a week the previous list leaves every copy. Here each
        # distinct version is kept forever — 5 KB apiece, against losing the
        # only copy of the code <-> person <-> level mapping.
        $hist = Join-Path $Root 'codes-history'
        New-Item -ItemType Directory -Force -Path $hist | Out-Null
        $hash = (Get-FileHash $csv -Algorithm SHA256).Hash.Substring(0, 12)
        if (-not (Get-ChildItem $hist -Filter ("*-{0}.csv" -f $hash))) {
            $snap = Join-Path $hist ('codes-{0}-{1}.csv' -f $Today, $hash)
            Copy-Item $csv $snap -Force
            Write-Log ('codes.csv: NEW content, kept as codes-history\{0}' -f (Split-Path $snap -Leaf))
        }
    } else {
        Write-Log 'WARNING: db\codes.csv is not in the repo — nothing copied'
    }

    # --- 3. Monthly snapshot, outside the rotation ------------------------
    # 26 KB a month. The daily dump lives 5 days; this one survives a mistake
    # that only gets noticed months later.
    $monthly = Join-Path $DbRoot 'monthly'
    New-Item -ItemType Directory -Force -Path $monthly | Out-Null
    $mFile = Join-Path $monthly ('d1-hybris-files-{0}.sql' -f (Get-Date -Format 'yyyy-MM'))
    if (-not (Test-Path $mFile)) {
        Copy-Item $sql $mFile -Force
        Write-Log ('monthly snapshot created: monthly\{0}' -f (Split-Path $mFile -Leaf))
    }

    # --- 4. Rotation ------------------------------------------------------
    # Runs only AFTER a validated backup, so today's failure never deletes the
    # good days. Removes only folders whose name is an exact date, directly
    # under <Root>\db — nothing else, nowhere else.
    $dated = Get-ChildItem $DbRoot -Directory |
             Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
             Sort-Object Name -Descending

    if ($dated.Count -gt $KeepDays) {
        foreach ($old in $dated | Select-Object -Skip $KeepDays) {
            Remove-Item $old.FullName -Recurse -Force
            Write-Log ('rotation: removed {0}' -f $old.Name)
        }
    }
    Write-Log ('keeping {0} day(s): {1}' -f
        [Math]::Min($dated.Count, $KeepDays),
        (($dated | Select-Object -First $KeepDays).Name -join ', '))

    # --- 5. Visible status ------------------------------------------------
    # A backup that fails silently is worse than none, because it is trusted.
    # This file sits at the root of the backup folder: if its date is not
    # recent, something stopped.
    Set-Content -Path (Join-Path $Root 'LAST-BACKUP.txt') -Encoding utf8 -Value @"
OK - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

$nCodes codes, $nLog access_log rows.
codes.csv: $(if (Test-Path $csv) { "$((Get-Content $csv).Count) lines" } else { 'MISSING' })

If the date above is not recent, the \Claude\Hybris-Backup task stopped.
Details in _tools\backup.log.
The PDFs under r2\ are refreshed BY HAND — they are not part of this task.
"@

    Write-Log '=== end, ok ==='
    exit 0
}
catch {
    Write-Log ('ERROR: ' + $_.Exception.Message)
    Write-Log '=== end, FAILED ==='
    Set-Content -Path (Join-Path $Root 'LAST-BACKUP.txt') -Encoding utf8 -Value @"
FAILED - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

$($_.Exception.Message)

Nothing was rotated: the previous days are intact.
Details in _tools\backup.log.
"@
    exit 1
}
