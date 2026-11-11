# Hirefolios restore: puts a backup folder (made by backup.ps1) back. Replaces ALL current data.
# As Administrator:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\restore.ps1 -From C:\hirefolios-backups\2026-11-11_181500
# Order: check the backup -> stop the app -> back up the current state -> unpack the files next to the uploads
# folder -> replace the database in ONE transaction -> swap the uploads folders -> start the app -> health check.
# If the database step fails nothing has changed. The previous uploads are kept in <uploads>.before-restore-<time>.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$From,
  # Default: the folder above this script (C:\hirefolios). Set below: Windows PowerShell 5.1 leaves
  # $PSScriptRoot empty inside param() defaults when a script is run with -File.
  [string]$InstallDir = "",
  # For scripted tests only: the word that would otherwise be typed.
  [string]$ConfirmWord = "",
  # The app is already stopped and is started by the caller (update.ps1 rollback, tests without the service).
  [switch]$NoService,
  # For scripted tests only: answer CONTINUE when the current data cannot be backed up first.
  [switch]$ContinueWithoutSafetyBackup
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }

$cfg = Get-InstallSetting $InstallDir
$uploads = $cfg["UPLOAD_DIR"].TrimEnd("\")
$pgBin = $cfg["PG_BIN"]
$db = Get-PgConnection $cfg["DATABASE_URL"]
$From = (Resolve-Path -LiteralPath $From).Path
$dump = Join-Path $From "database.dump"
$tgz = Join-Path $From "uploads.tar.gz"
if ($From -like "*.partial") { throw "$From is an unfinished backup (.partial) and cannot be restored." }
if (-not (Test-Path -LiteralPath $dump) -or -not (Test-Path -LiteralPath $tgz)) { throw "$From must contain database.dump and uploads.tar.gz" }

Write-Step "Checking the backup"
$manifest = Join-Path $From "manifest.txt"
if (Test-Path -LiteralPath $manifest) {
  foreach ($line in Get-Content -LiteralPath $manifest | Where-Object { $_ -like "sha256 *" }) {
    $null, $file, $hash, $null = $line -split " "
    if ((Get-FileSha256 (Join-Path $From $file)) -ne $hash) { throw "$file in $From is damaged (checksum does not match manifest.txt)" }
  }
  Write-Ok "files match manifest.txt"
} else {
  Write-Note "No manifest.txt (older backup): checking the archives instead"
}
Invoke-Native (Join-Path $pgBin "pg_restore.exe") @("--list", $dump) -Quiet | Out-Null
Invoke-Native $script:Tar @("-tzf", $tgz) -Quiet | Out-Null
Write-Ok "database dump and uploads archive are readable"

Write-Host ""
Write-Host "This REPLACES all current candidates, staff accounts, settings and files" -ForegroundColor Yellow
Write-Host "with the backup in $From" -ForegroundColor Yellow
Write-Host "Anything entered after that backup was made will be lost." -ForegroundColor Yellow
Write-Host ""
$answer = if ($ConfirmWord) { $ConfirmWord } else { Read-Answer "Type RESTORE (capitals) to continue" }
if ($answer -cne "RESTORE") { Write-Host "Cancelled. Nothing was changed."; exit 1 }
if (-not $NoService) { Assert-Admin }

# Stop first, so nothing is written between the safety backup and the restore.
if (-not $NoService) { Write-Step "Stopping the app"; Stop-AppService }
Write-Step "Backing up the current state first"
try {
  & (Join-Path $PSScriptRoot "backup.ps1") -InstallDir $InstallDir -Label "before-restore"
} catch {
  # The usual reason to restore is that the current data is damaged or gone, and then it cannot be backed up.
  Write-Warning "The current data could not be backed up: $($_.Exception.Message)"
  Write-Warning "It may be damaged or empty. Without this safety backup, the current data cannot be brought back later."
  $go = if ($ContinueWithoutSafetyBackup) { "CONTINUE" } else { Read-Answer "Type CONTINUE (capitals) to restore anyway" }
  if ($go -cne "CONTINUE") {
    if (-not $NoService) { Start-Service -Name $script:AppService }
    Write-Host "Cancelled. Nothing was changed."; exit 1
  }
}

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$incoming = "$uploads.restoring-$stamp"
$aside = "$uploads.before-restore-$stamp"
$sqlFile = Join-Path (Split-Path -Parent $From) "restore-$stamp.sql.tmp"
$dbRestored = $false
try {
  Write-Step "Unpacking the files"
  New-Item -ItemType Directory -Force -Path $incoming | Out-Null
  Invoke-Native $script:Tar @("-xzf", $tgz, "-C", $incoming) -Quiet | Out-Null

  Write-Step "Replacing the database (one transaction)"
  # Plain SQL from the dump, run after emptying the database, all inside one transaction: on any error PostgreSQL
  # rolls everything back and the current data stays. Emptying first also removes tables a newer version added.
  Invoke-Native (Join-Path $pgBin "pg_restore.exe") @("--no-owner", "--no-privileges", "-f", $sqlFile, $dump) -Quiet | Out-Null
  $pre = Join-Path (Split-Path -Parent $From) "restore-$stamp.pre.sql.tmp"
  [IO.File]::WriteAllText($pre, "DROP SCHEMA IF EXISTS drizzle CASCADE;`nDROP SCHEMA public CASCADE;`nCREATE SCHEMA public;`n")
  $env:PGPASSWORD = $db.Password
  try {
    Invoke-Native (Join-Path $pgBin "psql.exe") @("-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-h", $db.Host, "-p", "$($db.Port)",
      "-U", $db.User, "-d", $db.Database, "-f", $pre, "-f", $sqlFile) -Quiet | Out-Null
  } finally { $env:PGPASSWORD = $null; Remove-Item -LiteralPath $pre -Force -ErrorAction SilentlyContinue }
  $dbRestored = $true
  Write-Ok "database restored"

  if (Test-Path -LiteralPath $uploads) { Move-Item -LiteralPath $uploads -Destination $aside }
  Move-Item -LiteralPath $incoming -Destination $uploads
  # Backups are not in the archive's .last-backup: keep showing the real last backup time on the status card.
  if (Test-Path -LiteralPath "$aside\.last-backup") { Copy-Item -LiteralPath "$aside\.last-backup" -Destination $uploads }
  # New folder: give it the same permissions as before (the app service writes there).
  if (Test-Account (Get-ServiceSid $script:AppService)) { Protect-Path $uploads -Modify @(Get-ServiceSid $script:AppService) }
  Write-Ok "files restored"
} catch {
  Write-Warning "Restore failed: $($_.Exception.Message)"
  if (-not $dbRestored) {
    Write-Warning "Nothing was replaced: the database rolled back and the uploads folder is untouched."
    Remove-Item -LiteralPath $incoming -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    # The database is the backup's now; put the uploads folder back the way it was and keep the unpacked files.
    if (-not (Test-Path -LiteralPath $uploads) -and (Test-Path -LiteralPath $aside)) { Move-Item -LiteralPath $aside -Destination $uploads }
    Write-Warning "The DATABASE was restored but the files were not swapped in. The backup's files are in $incoming;"
    Write-Warning "move them to $uploads by hand (app stopped), or run this restore again."
  }
  if (-not $NoService) { Start-Service -Name $script:AppService }
  throw
} finally {
  Remove-Item -LiteralPath $sqlFile -Force -ErrorAction SilentlyContinue
}

if (-not $NoService) {
  Write-Step "Starting the app"
  Start-Service -Name $script:AppService
  $health = Wait-Health "http://127.0.0.1:$($cfg['PORT'])/api/health" -Seconds 120
  if (-not $health) { throw "The app did not report healthy after the restore. See $InstallDir\logs." }
  Write-Ok "app is running (version $($health.version))"
}
Write-Host ""
Write-Host "Restored from $From." -ForegroundColor Green
if (Test-Path -LiteralPath $aside) { Write-Host "The previous uploads are kept in $aside. Delete that folder once you have checked the restore." }
