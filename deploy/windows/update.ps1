# Hirefolios update: installs a new release and rolls back by itself if it does not come up healthy.
# As Administrator, with the new release unpacked (or its .zip):
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\update.ps1 -From D:\hirefolios-0.2.0
# Steps: check the release -> stop the app -> back up -> swap in the new app -> start (migrations run at start)
# -> health check (right version) -> done. If the health check fails: stop, put the old app back, put the
# database back from the backup if the new version changed it, start the old version, check it again.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$From,
  # Default: the folder above this script (C:\hirefolios). Set below: Windows PowerShell 5.1 leaves
  # $PSScriptRoot empty inside param() defaults when a script is run with -File.
  [string]$InstallDir = "",
  [int]$HealthSeconds = 180
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
. (Join-Path $PSScriptRoot "common.ps1")
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }
Assert-Admin

$cfg = Get-InstallSetting $InstallDir
$app = Join-Path $InstallDir "app"
$previous = Join-Path $InstallDir "app.previous"
$health = "http://127.0.0.1:$($cfg['PORT'])/api/health"
$db = Get-PgConnection $cfg["DATABASE_URL"]
$transcript = Join-Path $InstallDir "logs\update-$(Get-Date -Format yyyy-MM-dd_HHmmss).log"
Start-Transcript -Path $transcript | Out-Null

function Get-MigrationCount {
  $sql = "select case when to_regclass('drizzle.__drizzle_migrations') is null then 0 else (select count(*) from drizzle.__drizzle_migrations) end;"
  return [int](Invoke-Psql -Bin $cfg["PG_BIN"] -User $db.User -Password $db.Password -Database $db.Database -Sql $sql | Select-Object -First 1)
}

$staging = $null
try {
  Write-Step "Checking the new release"
  $From = (Resolve-Path -LiteralPath $From).Path
  if ($From -like "*.zip") {
    $staging = Join-Path $InstallDir "staging"
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Expand-Archive -LiteralPath $From -DestinationPath $staging
    $inner = @(Get-ChildItem -LiteralPath $staging -Directory)
    $From = if ($inner.Count -eq 1 -and -not (Test-Path (Join-Path $staging "app"))) { $inner[0].FullName } else { $staging }
  }
  foreach ($f in "app\server.js", "app\node\node.exe", "app\VERSION.txt", "app\release.env", "scripts\update.ps1", "scripts\versions.json") {
    if (-not (Test-Path (Join-Path $From $f))) { throw "$From is not a complete Hirefolios release ($f is missing)." }
  }
  $sig = Get-AuthenticodeSignature -FilePath (Join-Path $From "app\node\node.exe")
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "OpenJS Foundation") { throw "node.exe in the new release is not signed by the OpenJS Foundation." }
  # The new release's own versions.json says which Node.js and PostgreSQL major it needs.
  $newPins = Get-Content -Raw -LiteralPath (Join-Path $From "scripts\versions.json") | ConvertFrom-Json
  $nodeMajor = [int]("$(& (Join-Path $From 'app\node\node.exe') --version)".TrimStart("v").Split(".")[0])
  if ($nodeMajor -ne [int]$newPins.node.major) { throw "The new release ships Node.js $nodeMajor but its versions.json says $($newPins.node.major). Nothing was changed." }
  $pgMajorHere = [int](("$(& (Join-Path $cfg['PG_BIN'] 'pg_dump.exe') --version)" -replace '^\D+', '').Split(".")[0])
  if ($pgMajorHere -ne [int]$newPins.postgresql.major) { throw "The new release needs PostgreSQL $($newPins.postgresql.major); this PC has PostgreSQL $pgMajorHere. Nothing was changed." }
  Write-Ok "Node.js $nodeMajor and PostgreSQL $pgMajorHere match the new release's versions.json"
  $newVersion = (Get-Content (Join-Path $From "app\VERSION.txt") -TotalCount 1).Trim()
  $oldVersion = (Get-Content (Join-Path $app "VERSION.txt") -TotalCount 1).Trim()
  Write-Ok "installed: $oldVersion, new: $newVersion"
  if (-not (Wait-Health $health -Seconds 10)) { Write-Warning "The current version is not healthy right now; updating anyway (a rollback will return to it as it is)." }

  Write-Step "Stopping the app and backing up"
  Stop-AppService
  & (Join-Path $PSScriptRoot "backup.ps1") -InstallDir $InstallDir -Label "before-update-$newVersion"
  $backup = Get-ChildItem -LiteralPath $cfg["BACKUP_DIR"] -Directory | Where-Object { $_.Name -like "*_before-update-$newVersion" } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $backup) { throw "The backup before the update was not found." }
  $migrationsBefore = Get-MigrationCount

  Write-Step "Installing $newVersion"
  if (Test-Path $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
  Move-Item -LiteralPath $app -Destination $previous
  Copy-Item -LiteralPath (Join-Path $From "app") -Destination $app -Recurse
  Write-Ok "new app in place (old one kept in $previous)"

  Write-Step "Starting $newVersion (database changes run now)"
  Start-Service -Name $script:AppService
  $ok = Wait-Health $health -Seconds $HealthSeconds -Version $newVersion
  if ($ok) {
    # New scripts and docs come with the release (this script is already loaded, so replacing it is safe).
    Copy-Item -Path (Join-Path $From "scripts\*") -Destination (Join-Path $InstallDir "scripts") -Recurse -Force
    if (Test-Path (Join-Path $From "docs")) { Copy-Item -LiteralPath (Join-Path $From "docs") -Destination $InstallDir -Recurse -Force }
    Write-Host ""
    Write-Host "Updated to $newVersion. Backup from just before: $($backup.FullName)" -ForegroundColor Green
    return
  }

  # ------------------------------------------------------------- rollback
  Write-Warning "$newVersion did not come up healthy within $HealthSeconds s. Rolling back to $oldVersion."
  $logs = Get-ChildItem (Join-Path $InstallDir "logs") -Filter "hirefolios*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 2
  foreach ($f in $logs) { Write-Host "--- $($f.Name) (last lines)"; Get-Content -LiteralPath $f.FullName -Tail 15 }
  Stop-AppService
  $failed = Join-Path $InstallDir "app.failed-$newVersion"
  if (Test-Path $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
  Move-Item -LiteralPath $app -Destination $failed
  Move-Item -LiteralPath $previous -Destination $app
  if ((Get-MigrationCount) -ne $migrationsBefore) {
    Write-Note "The new version changed the database: putting it back from $($backup.Name)"
    & (Join-Path $PSScriptRoot "restore.ps1") -InstallDir $InstallDir -From $backup.FullName -ConfirmWord RESTORE -NoService
  } else {
    Write-Ok "database unchanged by the new version"
  }
  Start-Service -Name $script:AppService
  if (-not (Wait-Health $health -Seconds $HealthSeconds -Version $oldVersion)) {
    throw "ROLLBACK FAILED: $oldVersion is not healthy either. Logs: $InstallDir\logs. Backup: $($backup.FullName)"
  }
  Write-Host ""
  Write-Host "Update to $newVersion FAILED and was rolled back: $oldVersion is running again." -ForegroundColor Yellow
  Write-Host "The failed version is kept in $failed for a developer to look at. Log: $transcript"
  exit 2
} finally {
  if ($staging -and (Test-Path $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
  Stop-Transcript | Out-Null
}
