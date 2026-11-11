# Shared helpers for the Hirefolios Windows scripts (install, update, backup, restore, uninstall).
# Dot-sourced: . (Join-Path $PSScriptRoot "common.ps1")
# Keep this file ASCII only (Windows PowerShell 5.1 reads BOM-less files as the ANSI code page).
Set-StrictMode -Version 2.0

$script:AppService = "hirefolios"
$script:CaddyService = "hirefolios-caddy"
$script:BackupTask = "Hirefolios backup"
$script:FirewallGroup = "Hirefolios"
# Windows' own tar (bsdtar, Windows 10 1803+). Not "tar.exe" from PATH: Git's GNU tar reads "C:\..." as a remote host.
$script:Tar = Join-Path $env:SystemRoot "System32\tar.exe"
# Windows PowerShell 5.1 on older Windows 10 builds may offer only TLS 1.0 to https:// (Caddy needs 1.2+).
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Pinned tools, downloaded from their official GitHub releases by `npm run package` (scripts/package.mjs reads
# these lines) and checked again by install.ps1. WinSW.NET461 runs on the .NET Framework built into Windows 10/11.
$script:Tools = @{
  winsw = @{ Version = "2.12.0"; File = "WinSW.NET461.exe"; Url = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe"; Sha256 = "b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f" }
  caddy = @{ Version = "2.11.9"; File = "caddy_2.11.9_windows_amd64.zip"; Url = "https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_windows_amd64.zip"; Sha256 = "ad93112d335ee687100c4c9f11bced16ca590377976b7fe7883882b9e797e472" }
}

function Write-Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Write-Note([string]$text) { Write-Host "   $text" }

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Assert-Admin {
  if (-not (Test-Admin)) {
    throw "Run this as Administrator: right-click PowerShell, choose 'Run as administrator', then run the command again."
  }
}

# Runs a program and throws if it fails. Output goes to the console unless -Quiet (then it is returned).
function Invoke-Native {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @(), [switch]$Quiet, [int[]]$OkCodes = @(0))
  # PowerShell 5.1 turns a native program's stderr lines into errors under "Stop"; judge by the exit code instead.
  $ErrorActionPreference = "Continue"
  if ($Quiet) {
    $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
  } else {
    & $Exe @Arguments
    $out = $null
  }
  if ($OkCodes -notcontains $LASTEXITCODE) {
    $detail = if ($out) { ": " + (($out | Select-Object -Last 15) -join " | ") } else { "" }
    throw "$([IO.Path]::GetFileName($Exe)) failed (exit $LASTEXITCODE)$detail"
  }
  return $out
}

function New-Secret([int]$Bytes = 32) {
  $b = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  $rng.Dispose()
  return -join ($b | ForEach-Object { $_.ToString("x2") })
}

# .env: KEY=VALUE lines, values unquoted (Node's --env-file reads them literally).
function Read-EnvFile([string]$Path) {
  $map = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
  }
  return $map
}
function Write-EnvFile([string]$Path, [System.Collections.IDictionary]$Values, [string[]]$Header = @()) {
  $lines = @($Header) + @($Values.Keys | ForEach-Object { "$_=$($Values[$_])" })
  $tmp = "$Path.new"
  [IO.File]::WriteAllLines($tmp, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
  Protect-Path $tmp -Read @(Get-ServiceSid $script:AppService)
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-ServiceSid([string]$Name) { return "NT SERVICE\$Name" }

# Replaces the folder/file permissions: SYSTEM and Administrators full control, plus the given accounts.
function Protect-Path {
  param([Parameter(Mandatory)][string]$Path, [string[]]$Read = @(), [string[]]$Modify = @())
  $grants = @("*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
  $isDir = (Get-Item -LiteralPath $Path -Force).PSIsContainer
  $inherit = if ($isDir) { "(OI)(CI)" } else { "" }
  if (-not $isDir) { $grants = @("*S-1-5-18:F", "*S-1-5-32-544:F") }
  foreach ($a in $Read) { if ($a -and (Test-Account $a)) { $grants += "${a}:${inherit}RX" } }
  foreach ($a in $Modify) { if ($a -and (Test-Account $a)) { $grants += "${a}:${inherit}M" } }
  $icaclsArgs = @($Path, "/inheritance:r", "/Q")
  foreach ($g in $grants) { $icaclsArgs += @("/grant:r", $g) }
  Invoke-Native icacls.exe $icaclsArgs -Quiet | Out-Null
}
function Test-Account([string]$Name) {
  try { [void](New-Object Security.Principal.NTAccount($Name)).Translate([Security.Principal.SecurityIdentifier]); return $true } catch { return $false }
}

function Get-PgConnection([string]$Url) {
  $u = [Uri]$Url
  $userInfo = $u.UserInfo.Split(":", 2)
  return @{
    Host = $u.Host; Port = $(if ($u.Port -gt 0) { $u.Port } else { 5432 })
    User = [Uri]::UnescapeDataString($userInfo[0]); Password = [Uri]::UnescapeDataString($userInfo[1])
    Database = $u.AbsolutePath.TrimStart("/")
  }
}

# PostgreSQL installs (EDB installer / winget) register themselves here.
function Find-PostgreSQL {
  $found = @()
  foreach ($key in Get-ChildItem "HKLM:\SOFTWARE\PostgreSQL\Installations" -ErrorAction SilentlyContinue) {
    $p = Get-ItemProperty $key.PSPath
    $bin = Join-Path $p."Base Directory" "bin"
    if (Test-Path (Join-Path $bin "pg_dump.exe")) {
      $found += [pscustomobject]@{ Major = [int](($p.Version -split "\.")[0]); Version = $p.Version; Bin = $bin; Service = $p."Service ID"; DataDir = $p."Data Directory" }
    }
  }
  return $found | Sort-Object Major -Descending
}

function Get-InstallSetting([string]$InstallDir) {
  $envPath = Join-Path $InstallDir ".env"
  if (-not (Test-Path -LiteralPath $envPath)) { throw "Settings file $envPath not found. Is Hirefolios installed here?" }
  return Read-EnvFile $envPath
}

# Waits until GET <url> answers 200 with status "ok" (and the given version, if any). Returns the parsed body or $null.
function Wait-Health {
  param([Parameter(Mandatory)][string]$Url, [int]$Seconds = 90, [string]$Version = "")
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      $body = $r.Content | ConvertFrom-Json
      if ($r.StatusCode -eq 200 -and $body.status -eq "ok" -and (-not $Version -or $body.version -eq $Version)) { return $body }
    } catch {
      Write-Verbose "health: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Stop-AppService([string]$Name = $script:AppService) {
  $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $svc -or $svc.Status -eq "Stopped") { return }
  Stop-Service -Name $Name -Force
  (Get-Service -Name $Name).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(60))
}

function Get-FileSha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Get-CertFingerprint([Security.Cryptography.X509Certificates.X509Certificate2]$Cert) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hex = -join ($sha.ComputeHash($Cert.RawData) | ForEach-Object { $_.ToString("X2") })
  $sha.Dispose()
  return ($hex -split "(.{4})" | Where-Object { $_ }) -join " "
}

# Read-Host returns $null (not "") when there is no console input (input redirected, end of input).
function Read-Answer([string]$Prompt) { return "$(Read-Host -Prompt $Prompt)".Trim() }
function Read-Secret([string]$Prompt) {
  $s = Read-Host -Prompt $Prompt -AsSecureString
  if ($null -eq $s) { return "" }
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# Runs SQL through psql (sent on stdin, so passwords never appear on a command line).
function Invoke-Psql {
  param([Parameter(Mandatory)][string]$Bin, [Parameter(Mandatory)][string]$User, [Parameter(Mandatory)][string]$Password,
        [string]$Database = "postgres", [int]$Port = 5432, [Parameter(Mandatory)][string]$Sql)
  $ErrorActionPreference = "Continue" # psql NOTICEs go to stderr; the exit code decides
  $old = $env:PGPASSWORD
  $env:PGPASSWORD = $Password
  try {
    $out = $Sql | & (Join-Path $Bin "psql.exe") -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U $User -d $Database 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $(($out | Select-Object -Last 5) -join ' | ')" }
    return $out
  } finally { $env:PGPASSWORD = $old }
}
