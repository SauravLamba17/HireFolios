# Hirefolios restore: puts a backup folder (made by backup.ps1) back. Replaces ALL current data.
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\restore.ps1 -From C:\hirefolios-backups\2026-11-11_1815
# A backup of the current state is taken first, and the current uploads folder is kept aside.
param(
  [Parameter(Mandatory = $true)][string]$From,
  [string]$BackupDir = "C:\hirefolios-backups",
  [string]$Confirm = ""
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
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

$dump = Join-Path $From "database.dump"
$tgz = Join-Path $From "uploads.tar.gz"
if (-not (Test-Path $dump) -or -not (Test-Path $tgz)) { throw "$From must contain database.dump and uploads.tar.gz" }
$uploads = (Get-Setting "UPLOAD_HOST_DIR").TrimEnd("\")
if (-not $uploads) { throw "UPLOAD_HOST_DIR is not set in .env.production" }

Write-Host ""
Write-Host "This REPLACES all current candidates, staff accounts, settings and files"
Write-Host "with the backup in $From"
Write-Host "Anything entered after that backup was made will be lost."
Write-Host ""
$answer = if ($Confirm) { $Confirm } else { Read-Host "Type RESTORE (capitals) to continue" }
if ($answer -cne "RESTORE") { Write-Host "Cancelled. Nothing was changed."; exit 1 }

Write-Host "Backing up the current state first..."
# No pruning here: it could remove the very backup being restored.
& (Join-Path $PSScriptRoot "backup.ps1") -BackupDir $BackupDir -KeepDays 36500

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$aside = "$uploads.before-restore-$stamp"
Invoke-Compose stop app
try {
  if (Test-Path $uploads) { Move-Item -Path $uploads -Destination $aside }
  New-Item -ItemType Directory -Force -Path $uploads | Out-Null
  & tar.exe -xzf $tgz -C $uploads
  if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
  Invoke-Compose cp $dump db:/tmp/restore.dump
  # One transaction: if anything fails, the database stays as it was.
  Invoke-Compose exec -T db sh -c 'pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner --single-transaction /tmp/restore.dump'
  Invoke-Compose exec -T db rm -f /tmp/restore.dump
} catch {
  Write-Warning "Restore failed: $_"
  if (Test-Path $aside) {
    Remove-Item -Recurse -Force $uploads -ErrorAction SilentlyContinue
    Move-Item -Path $aside -Destination $uploads
    Write-Warning "The uploads folder was put back as it was."
  }
  Invoke-Compose start app
  throw
}
Invoke-Compose start app
Write-Host ""
Write-Host "Restored from $From."
if (Test-Path $aside) { Write-Host "The previous uploads are kept in $aside. Delete that folder once you have checked the restore." }
