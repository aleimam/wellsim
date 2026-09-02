<#
    Pull the newest encrypted WellSim backup off the VPS to this workstation.

    This is the hop that has never existed. Every backup on that server -- the
    app's rolling copy, wellsim-backup.timer, and now the encrypted one --
    writes to the same disk as the thing it protects. They survive a bad write,
    a bad deploy or an accidental delete. They do not survive a lost server.

    Runs unattended under Task Scheduler. It never decrypts: the age identity
    is NOT needed to pull, and deliberately should not be on the machine that
    runs this on a timer. Verification here is by SHA256SUMS, which proves the
    transfer, not the contents.

    Windows PowerShell 5.1 compatible (no ternary, no && chaining).

    Setup, once:
      1. Generate a pull key on THIS machine (no passphrase -- it is powerless
         on its own, see deploy/serve-wellsim-backup.sh):
             ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\wellsim_pull -C wellsim-backup-pull -N '""'
      2. Add its PUBLIC half to /root/.ssh/authorized_keys on the server, as
         ONE line, with the forced command:
             restrict,command="/opt/wellsim/app/deploy/serve-wellsim-backup.sh" ssh-ed25519 AAAA... wellsim-backup-pull
      3. Test it by hand before scheduling:
             powershell -File pull-wellsim-backup.ps1 -WhatIfList
      4. Schedule it:
             schtasks /create /tn "WellSim backup pull" /sc daily /st 04:30 ^
               /tr "powershell -NonInteractive -ExecutionPolicy Bypass -File D:\TheSimplestNode\deploy\pull-wellsim-backup.ps1"
#>
[CmdletBinding()]
param(
    [string] $Server     = 'root@91.98.23.255',
    [string] $KeyPath    = "$env:USERPROFILE\.ssh\wellsim_pull",
    [string] $Destination = 'D:\WellSim-Backups',
    # Set to a drive letter to also drop a copy on removable media when it
    # happens to be plugged in. A USB stick cannot be the primary target of a
    # scheduled job -- it is not mounted when the job runs -- so it is treated
    # as an opportunistic second copy, never as success or failure.
    [string] $AlsoCopyTo = 'F:\WellSim-RecoveryKit\archives',
    [switch] $WhatIfList
)

$ErrorActionPreference = 'Stop'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'

function Fail([string] $Message) {
    Write-Error $Message
    exit 1
}

if (-not (Test-Path $ssh))     { Fail "OpenSSH client not found at $ssh" }
if (-not (Test-Path $KeyPath)) { Fail "Pull key not found at $KeyPath. See the setup notes at the top of this script." }

$sshArgs = @(
    '-i', $KeyPath,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=30',
    $Server
)

# --- list mode: prove the key and the forced command work, fetch nothing ---
if ($WhatIfList) {
    $names = & $ssh @sshArgs 'list'
    if ($LASTEXITCODE -ne 0) { Fail "Listing failed (exit $LASTEXITCODE). The key, the forced command, or host-key trust is not in place." }
    Write-Output 'Backups on the server, oldest first:'
    $names | ForEach-Object { Write-Output "  $_" }
    exit 0
}

if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }

# Stream straight to a temp tar, then extract. Writing the stream to disk first
# means a truncated transfer fails at extraction rather than half-populating
# the destination.
$stamp   = Get-Date -Format 'yyyyMMddTHHmmssZ'
$tarPath = Join-Path $env:TEMP "wellsim-pull-$stamp.tar"

try {
    # cmd.exe does the redirect: PowerShell 5.1's own pipeline mangles binary.
    & cmd.exe /c "`"$ssh`" -i `"$KeyPath`" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=30 $Server latest > `"$tarPath`""
    if ($LASTEXITCODE -ne 0) { Fail "Transfer failed (exit $LASTEXITCODE)." }

    $size = (Get-Item $tarPath).Length
    if ($size -lt 1024) { Fail "Transfer produced only $size bytes -- treating as a failure, not a backup." }

    & tar.exe -xf $tarPath -C $Destination
    if ($LASTEXITCODE -ne 0) { Fail "Extraction failed (exit $LASTEXITCODE)." }
}
finally {
    if (Test-Path $tarPath) { Remove-Item $tarPath -Force -ErrorAction SilentlyContinue }
}

# --- verify what landed ---
$newest = Get-ChildItem $Destination -Directory -Filter 'wellsim-data-*' |
          Sort-Object Name | Select-Object -Last 1
if ($null -eq $newest) { Fail 'Nothing extracted.' }

$sumsFile = Join-Path $newest.FullName 'SHA256SUMS'
if (-not (Test-Path $sumsFile)) { Fail "No SHA256SUMS in $($newest.Name)." }

$bad = @()
foreach ($line in Get-Content $sumsFile) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
        $expected = $Matches[1].ToLower()
        $file     = Join-Path $newest.FullName $Matches[2].Trim()
        if (-not (Test-Path $file)) { $bad += "missing: $($Matches[2])"; continue }
        $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) { $bad += "checksum: $($Matches[2])" }
    }
}
if ($bad.Count -gt 0) { Fail "Verification failed in $($newest.Name): $($bad -join '; ')" }

# Freshness must be visible without comparing folder dates -- that is exactly
# how the F: kit went four days stale without anyone noticing.
$manifest = Join-Path $newest.FullName 'manifest.txt'
$jsonLine = ''
if (Test-Path $manifest) {
    $jsonLine = (Get-Content $manifest | Where-Object { $_ -like 'plaintext_json_files=*' }) -join ''
}
@(
    "last successful pull : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "archive              : $($newest.Name)",
    "verified             : SHA256SUMS OK",
    "source               : $Server",
    $jsonLine,
    '',
    'This file is written ONLY after checksum verification passes.',
    'If its date is old, the pull has been failing -- check Task Scheduler history.'
) | Set-Content (Join-Path $Destination 'LAST-PULL.txt') -Encoding utf8

# --- opportunistic removable copy ---
if ($AlsoCopyTo) {
    $root = Split-Path -Qualifier $AlsoCopyTo
    if (Test-Path $root) {
        try {
            if (-not (Test-Path $AlsoCopyTo)) { New-Item -ItemType Directory -Path $AlsoCopyTo -Force | Out-Null }
            Copy-Item $newest.FullName -Destination $AlsoCopyTo -Recurse -Force
            Copy-Item (Join-Path $Destination 'LAST-PULL.txt') -Destination (Split-Path $AlsoCopyTo -Parent) -Force
            Write-Output "Copied to $AlsoCopyTo"
        } catch {
            # Never fail the run over the removable copy: the primary pull
            # already succeeded and is verified.
            Write-Warning "Removable copy skipped: $($_.Exception.Message)"
        }
    } else {
        Write-Output "$root not mounted -- removable copy skipped (primary pull succeeded)."
    }
}

Write-Output "OK: $($newest.Name) pulled and verified into $Destination"
