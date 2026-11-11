# Hirefolios backup: database dump + uploads archive into BackupDir\<date_time>, keeps KeepDays days.
# Run from Task Scheduler at 6:15 pm Mon-Sat (docs/INSTALL.md), or by hand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\backup.ps1
# Optional: -OffsiteDir E:\hirefolios-backups (USB disk or a synced folder) gets a copy too.
param(
  [string]$BackupDir = "C:\hirefolios-backups",
  [int]$KeepDays = 14,
  [string]$OffsiteDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.production"
if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
Set-Location $root

function Get-Setting([string]$name) {
  $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -replace "^\s*$name\s*=\s*", "").Trim().Trim('"')
}
function Invoke-Compose {
  & docker compose --env-file $envFile @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') failed (exit $LASTEXITCODE)" }
}
function Remove-OldBackups([string]$dir) {
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  # Only folders this script made (named yyyy-MM-dd_HHmm) are ever removed.
  Get-ChildItem -Path $dir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } | ForEach-Object {
    $made = [datetime]::ParseExact($_.Name, "yyyy-MM-dd_HHmm", $null)
    if ($made -lt $cutoff) { Remove-Item -Recurse -Force $_.FullName }
  }
}

$uploads = Get-Setting "UPLOAD_HOST_DIR"
if (-not $uploads -or -not (Test-Path $uploads)) { throw "UPLOAD_HOST_DIR '$uploads' not found" }
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$dest = Join-Path $BackupDir $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$log = Join-Path $BackupDir "backup.log"

try {
  # pg_dump inside the db container (no password needed there), then copy the file out.
  Invoke-Compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/hirefolios.dump'
  Invoke-Compose cp db:/tmp/hirefolios.dump (Join-Path $dest "database.dump")
  Invoke-Compose exec -T db rm -f /tmp/hirefolios.dump
  & tar.exe -czf (Join-Path $dest "uploads.tar.gz") -C $uploads --exclude=./.last-backup .
  if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
  $dumpSize = (Get-Item (Join-Path $dest "database.dump")).Length
  if ($dumpSize -lt 1024) { throw "database.dump is only $dumpSize bytes" }

  if ($OffsiteDir) {
    New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null
    Copy-Item -Recurse -Path $dest -Destination (Join-Path $OffsiteDir $stamp)
    Remove-OldBackups $OffsiteDir
  }
  Remove-OldBackups $BackupDir
  # The admin status card and /api/health show this time.
  Set-Content -Path (Join-Path $uploads ".last-backup") -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding ascii
  $mb = [math]::Round(((Get-ChildItem $dest | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Add-Content -Path $log -Value "$stamp OK $mb MB$(if ($OffsiteDir) { " (+ offsite copy)" })"
  Write-Host "Backup saved: $dest ($mb MB)"
} catch {
  Add-Content -Path $log -Value "$stamp FAILED: $_"
  throw
}
