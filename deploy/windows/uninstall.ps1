# Hirefolios uninstall, as Administrator:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\hirefolios\scripts\uninstall.ps1
# Removes the two Hirefolios services, the backup task, the firewall rule, this PC's hosts line and certificate
# trust, and C:\hirefolios (app, scripts, logs, HTTPS certificates).
# KEPT unless you ask (each asks you to type a word first):
#   the database and C:\hirefolios-data (candidates, photos, CVs)   -> -RemoveData
#   the backups folder                                              -> -RemoveBackups
#   PostgreSQL itself (only if install.ps1 installed it)            -> -RemovePostgreSQL (needs -RemoveData)
# When the data is kept, the settings file is moved to C:\hirefolios-data\config so a later install.ps1
# connects to the same database again.
[CmdletBinding()]
param(
  [string]$InstallDir = "C:\hirefolios",
  [switch]$RemoveData,
  [switch]$RemoveBackups,
  [switch]$RemovePostgreSQL,
  # For scripted tests only: the words that would otherwise be typed.
  [string[]]$ConfirmWords = @()
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
if ($RemovePostgreSQL -and -not $RemoveData) { throw "-RemovePostgreSQL also deletes the database: use it together with -RemoveData." }

# "-File ... -ConfirmWords A,B" arrives as one string "A,B": split it.
$given = @($ConfirmWords | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() })
function Confirm-Word([string]$Word, [string]$What) {
  Write-Host ""
  Write-Host $What -ForegroundColor Yellow
  $typed = if ($given -contains $Word) { $Word } else { Read-Answer "Type $Word (capitals) to confirm, anything else keeps it" }
  return $typed -ceq $Word
}

$envPath = Join-Path $InstallDir ".env"
$cfg = Read-EnvFile $envPath
$dataDir = if ($cfg["UPLOAD_DIR"]) { Split-Path -Parent $cfg["UPLOAD_DIR"] } else { "C:\hirefolios-data" }
$backupDir = if ($cfg["BACKUP_DIR"]) { $cfg["BACKUP_DIR"] } else { "C:\hirefolios-backups" }

if (-not (Confirm-Word "UNINSTALL" "This removes the Hirefolios program from this PC. Candidate data and backups are KEPT unless you chose otherwise.")) {
  Write-Host "Cancelled. Nothing was changed."; exit 1
}
$dropData = $RemoveData -and (Confirm-Word "DELETE" "-RemoveData: the database and every candidate photo and CV in $dataDir will be DELETED for good.")
$dropBackups = $RemoveBackups -and (Confirm-Word "DELETE" "-RemoveBackups: every backup in $backupDir will be DELETED for good.")
$dropPg = $RemovePostgreSQL -and $dropData
if ($dropPg -and $cfg["PG_INSTALLED_BY_HIREFOLIOS"] -ne "1") { Write-Warning "PostgreSQL was not installed by Hirefolios: it is left in place."; $dropPg = $false }

Write-Step "Services"
foreach ($name in $script:CaddyService, $script:AppService) {
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
    Stop-AppService $name
    Invoke-Native sc.exe @("delete", $name) -Quiet | Out-Null
    Write-Ok "removed service $name"
  }
}
Get-ScheduledTask -TaskName $script:BackupTask -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
Get-NetFirewallRule -Group $script:FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Ok "backup task and firewall rule removed"
if ($cfg["APP_DOMAIN"]) { & (Join-Path $PSScriptRoot "set-hosts.ps1") -Name $cfg["APP_DOMAIN"] -Remove | Out-Null; Write-Ok "hosts line removed" }
$crt = Join-Path $InstallDir "hirefolios-root.crt"
if (Test-Path -LiteralPath $crt) {
  $thumb = (New-Object Security.Cryptography.X509Certificates.X509Certificate2($crt)).Thumbprint
  $store = New-Object Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
  $store.Open("ReadWrite")
  $store.Certificates | Where-Object { $_.Thumbprint -eq $thumb } | ForEach-Object { $store.Remove($_) }
  $store.Close()
  Write-Ok "this PC no longer trusts the Hirefolios certificate (other PCs: trust-certificate.ps1 -Remove)"
}

if ($dropData -and $cfg["DATABASE_URL"]) {
  Write-Step "Deleting the data"
  $super = $cfg["PG_SUPERUSER_PASSWORD"]
  if (-not $super) { $super = Read-Secret "Password of the PostgreSQL 'postgres' user" }
  Invoke-Psql -Bin $cfg["PG_BIN"] -User postgres -Password $super -Sql "DROP DATABASE IF EXISTS hirefolios WITH (FORCE);" | Out-Null
  Invoke-Psql -Bin $cfg["PG_BIN"] -User postgres -Password $super -Sql "DROP ROLE IF EXISTS hirefolios;" | Out-Null
  Write-Ok "database deleted"
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force; Write-Ok "$dataDir deleted" }
} elseif (Test-Path -LiteralPath $envPath) {
  # Keep the settings with the data (same private permissions), so a reinstall finds the same database.
  $keepDir = Join-Path $dataDir "config"
  New-Item -ItemType Directory -Force -Path $keepDir | Out-Null
  Protect-Path $keepDir
  Move-Item -LiteralPath $envPath -Destination (Join-Path $keepDir "hirefolios.env") -Force
  Write-Ok "data kept in $dataDir and the database; settings kept in $keepDir"
}
if ($dropBackups -and (Test-Path -LiteralPath $backupDir)) { Remove-Item -LiteralPath $backupDir -Recurse -Force; Write-Ok "$backupDir deleted" }
elseif (Test-Path -LiteralPath $backupDir) { Write-Ok "backups kept in $backupDir" }

if ($dropPg) {
  Write-Step "Removing PostgreSQL"
  $pg = Find-PostgreSQL | Where-Object { $_.Bin -eq $cfg["PG_BIN"] } | Select-Object -First 1
  $un = if ($pg) { Join-Path (Split-Path -Parent $pg.Bin) "uninstall-postgresql.exe" } else { "" }
  if ($un -and (Test-Path $un)) {
    $p = Start-Process -FilePath $un -ArgumentList "--mode unattended --unattendedmodeui none" -Wait -PassThru
    if ($p.ExitCode -ne 0) { Write-Warning "The PostgreSQL uninstaller ended with code $($p.ExitCode); remove it in Settings > Apps." }
    else {
      # The uninstaller leaves the data folder and some files behind; this PostgreSQL was installed by install.ps1.
      $baseDir = Split-Path -Parent $pg.Bin
      foreach ($d in $pg.DataDir, $baseDir) { if ($d -and (Test-Path -LiteralPath $d)) { Remove-Item -LiteralPath $d -Recurse -Force } }
      $parent = Split-Path -Parent $baseDir
      if ((Split-Path -Leaf $parent) -eq "PostgreSQL" -and (Test-Path -LiteralPath $parent) -and -not (Get-ChildItem -LiteralPath $parent -Force)) { Remove-Item -LiteralPath $parent -Force }
      # ... and its registry key, emptied (Installations, Services) but not removed. Only when nothing else is registered.
      $reg = "HKLM:\SOFTWARE\PostgreSQL"
      if ((Test-Path $reg) -and -not (Get-Item $reg).Property.Count -and -not (Get-ChildItem $reg -Recurse | Where-Object { $_.Property.Count -or $_.SubKeyCount })) { Remove-Item $reg -Recurse -Force }
      Write-Ok "PostgreSQL removed"
    }
  } else { Write-Warning "PostgreSQL uninstaller not found; remove it in Settings > Apps." }
}

Write-Step "Service accounts"
# Each service ran as its own account (NT SERVICE\<name>), which Windows gave a profile folder in
# ServiceProfiles. Right after the service stops, Windows still holds it for a few seconds: retry, never fail.
foreach ($name in $script:AppService, $script:CaddyService) {
  $path = Join-Path $env:SystemRoot "ServiceProfiles\$name"
  foreach ($prof in @(Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -ieq $path })) {
    $gone = $false
    for ($i = 0; $i -lt 10 -and -not $gone; $i++) {
      try { $prof | Remove-CimInstance -ErrorAction Stop; $gone = $true } catch { Start-Sleep -Seconds 3 }
    }
    if ($gone) { Write-Ok "removed the Windows profile of NT SERVICE\$name" }
    else {
      Write-Warning "Windows still holds the empty profile $path until the next restart. After restarting, to remove it (PowerShell as Administrator):"
      Write-Warning "  Get-CimInstance Win32_UserProfile | Where-Object LocalPath -like '*\ServiceProfiles\hirefolios*' | Remove-CimInstance"
    }
  }
}

Write-Step "Program files"
Set-Location $env:SystemRoot # not inside the folder being deleted
# This script runs from $InstallDir\scripts: Windows lets PowerShell delete the file it is running.
Remove-Item -LiteralPath $InstallDir -Recurse -Force
Write-Ok "$InstallDir removed"
Write-Host ""
Write-Host "Hirefolios is uninstalled." -ForegroundColor Green
