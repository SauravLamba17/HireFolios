# Hirefolios backup: database dump + uploads archive into <BackupDir>\<yyyy-MM-dd_HHmmss>\.
# Runs from Task Scheduler (6:15 pm Mon-Sat, set up by install.ps1) or by hand, as Administrator:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\backup.ps1
# A backup is first written to <name>.partial and renamed only after it has been checked, so a power cut
# mid-backup never leaves a half backup that looks complete. Keeps KeepDays days (always the newest 3).
# Optional second copy (USB disk, second drive): -CopyTo E:\hirefolios-backups or BACKUP_COPY_DIR in .env.
[CmdletBinding()]
param(
  # Default: the folder above this script (C:\hirefolios). Set below: Windows PowerShell 5.1 leaves
  # $PSScriptRoot empty inside param() defaults when a script is run with -File.
  [string]$InstallDir = "",
  [string]$BackupDir = "",
  [int]$KeepDays = 0,
  [string]$CopyTo = "",
  [string]$Label = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $PSScriptRoot }

$cfg = Get-InstallSetting $InstallDir
if (-not $BackupDir) { $BackupDir = $cfg["BACKUP_DIR"] }
if (-not $KeepDays) { $KeepDays = [int]$(if ($cfg["BACKUP_KEEP_DAYS"]) { $cfg["BACKUP_KEEP_DAYS"] } else { 14 }) }
if (-not $CopyTo -and $cfg.Contains("BACKUP_COPY_DIR")) { $CopyTo = $cfg["BACKUP_COPY_DIR"] }
$uploads = $cfg["UPLOAD_DIR"]
$pgBin = $cfg["PG_BIN"]
if (-not $BackupDir) { throw "BACKUP_DIR is not set in $InstallDir\.env" }
if (-not $uploads -or -not (Test-Path -LiteralPath $uploads)) { throw "Uploads folder '$uploads' (UPLOAD_DIR) not found" }
if (-not (Test-Path (Join-Path $pgBin "pg_dump.exe"))) { throw "pg_dump.exe not found in PG_BIN '$pgBin'" }
$db = Get-PgConnection $cfg["DATABASE_URL"]

# One backup at a time (the scheduled one, a manual one, or one started by update / restore).
$mutex = New-Object Threading.Mutex($false, "Global\HirefoliosBackup")
try {
  if (-not $mutex.WaitOne([TimeSpan]::FromMinutes(30))) { throw "Another backup has been running for 30 minutes; try again later." }
} catch [Threading.AbandonedMutexException] {
  Write-Verbose "the previous backup was cut off (power cut, killed); its lock is ours now"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$log = Join-Path $BackupDir "backup.log"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$name = if ($Label) { "${stamp}_$Label" } else { $stamp }
$final = Join-Path $BackupDir $name
$work = "$final.partial"

function Remove-ExpiredBackup([string]$dir) {
  # Only folders this script made are touched. Leftover .partial folders (power cut, crash) are removed after a day.
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  Get-ChildItem -LiteralPath $dir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{6}(_[\w.-]+)?\.partial$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
  $done = @(Get-ChildItem -LiteralPath $dir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{6}(_[\w.-]+)?$' } | Sort-Object Name -Descending)
  $done | Select-Object -Skip 3 | Where-Object {
    [datetime]::ParseExact($_.Name.Substring(0, 17), "yyyy-MM-dd_HHmmss", $null) -lt $cutoff
  } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

try {
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $dump = Join-Path $work "database.dump"
  $env:PGPASSWORD = $db.Password
  try {
    Invoke-Native (Join-Path $pgBin "pg_dump.exe") @("-h", $db.Host, "-p", "$($db.Port)", "-U", $db.User, "-d", $db.Database, "-Fc", "-f", $dump) -Quiet | Out-Null
    # Reads the whole archive's table of contents: fails on a cut-off or damaged file.
    $toc = Invoke-Native (Join-Path $pgBin "pg_restore.exe") @("--list", $dump) -Quiet
  } finally { $env:PGPASSWORD = $null }
  if (-not ($toc -match "TABLE DATA public candidates ")) { throw "database.dump does not list the candidates table" }

  $tgz = Join-Path $work "uploads.tar.gz"
  Invoke-Native $script:Tar @("-czf", $tgz, "-C", $uploads, "--exclude", "./.last-backup", ".") -Quiet | Out-Null
  Invoke-Native $script:Tar @("-tzf", $tgz) -Quiet | Out-Null # reads it back to the end

  $version = Get-Content -LiteralPath (Join-Path $InstallDir "app\VERSION.txt") -TotalCount 1 -ErrorAction SilentlyContinue
  $manifest = @("made=$((Get-Date).ToString('o'))", "version=$version", "database=$($db.Database)")
  foreach ($f in Get-ChildItem -LiteralPath $work -File) { $manifest += "sha256 $($f.Name) $(Get-FileSha256 $f.FullName) $($f.Length)" }
  [IO.File]::WriteAllLines((Join-Path $work "manifest.txt"), [string[]]$manifest)
  Rename-Item -LiteralPath $work -NewName (Split-Path -Leaf $final)

  $copyNote = ""
  if ($CopyTo) {
    try {
      New-Item -ItemType Directory -Force -Path $CopyTo | Out-Null
      Copy-Item -LiteralPath $final -Destination (Join-Path $CopyTo "$name.partial") -Recurse
      Rename-Item -LiteralPath (Join-Path $CopyTo "$name.partial") -NewName $name
      Remove-ExpiredBackup $CopyTo
      $copyNote = " (+ copy in $CopyTo)"
    } catch {
      # The main backup is fine; say loudly that the second copy is not.
      $copyNote = " (COPY TO $CopyTo FAILED: $($_.Exception.Message))"
      Write-Warning "Second copy failed: $($_.Exception.Message)"
    }
  }
  Remove-ExpiredBackup $BackupDir
  # The admin status card and /api/health show this time.
  [IO.File]::WriteAllText((Join-Path $uploads ".last-backup"), (Get-Date).ToUniversalTime().ToString("o"))
  $mb = [math]::Round(((Get-ChildItem -LiteralPath $final -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Add-Content -LiteralPath $log -Value "$name OK $mb MB$copyNote"
  Write-Host "Backup saved: $final ($mb MB)$copyNote"
} catch {
  Add-Content -LiteralPath $log -Value "$name FAILED: $($_.Exception.Message)"
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  throw
} finally {
  $mutex.ReleaseMutex()
}
