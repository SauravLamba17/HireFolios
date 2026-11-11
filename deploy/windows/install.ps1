# Hirefolios installer for one Windows 10/11 office PC (the "server PC"). Safe to run again: it keeps the
# existing settings, database and files, and only adds or repairs what is missing.
#
# Run as Administrator from the unpacked release folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
#
# It sets up three Windows services that start on boot: PostgreSQL 16, Hirefolios (Node.js) and
# Hirefolios HTTPS (Caddy). See docs\INSTALL.md.
[CmdletBinding()]
param(
  [string]$Domain = "",
  [ValidateSet("", "internal", "cloudflare")][string]$HttpsOption = "",
  [string]$AdminEmail = "",
  [string]$AdminName = "Admin",
  # Scripted installs only. Normally leave it out and type the password when asked: a password written on the
  # command line is also recorded in the install log's header (logs\install-*.log, Administrators only).
  [securestring]$AdminPassword,
  # PostgreSQL that is already installed (not by this script): its "postgres" password.
  [securestring]$PostgresSuperuserPassword,
  # No internet: the PostgreSQL 16 installer (.exe from enterprisedb.com) copied to this PC.
  [string]$PostgresInstaller = "",
  [string]$InstallDir = "C:\hirefolios",
  [string]$DataDir = "C:\hirefolios-data",
  [string]$BackupDir = "C:\hirefolios-backups",
  [int]$AppPort = 3000,
  [switch]$SkipBackupTask
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is very slow with the progress bar on 5.1
. (Join-Path $PSScriptRoot "common.ps1")

$release = Split-Path -Parent $PSScriptRoot
$started = Get-Date

# ---------------------------------------------------------------- checks
Write-Step "Checking this PC"
Assert-Admin
$os = [Environment]::OSVersion.Version
if ($os.Major -lt 10 -or $os.Build -lt 17763) { throw "Windows 10 (version 1809 or later) or Windows 11 is needed; this PC has $os." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "A 64-bit Windows is needed." }
Write-Ok "Windows $($os.Major) build $($os.Build), 64-bit, running as Administrator"
foreach ($f in "app\server.js", "app\node\node.exe", "app\VERSION.txt", "tools") {
  if (-not (Test-Path (Join-Path $release $f))) { throw "$release is not a complete Hirefolios release ($f is missing). Unpack the release zip again." }
}
$version = (Get-Content (Join-Path $release "app\VERSION.txt") -TotalCount 1).Trim()
Write-Ok "release $version"
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($DataDir).Substring(0, 1))
$freeGB = [math]::Round($drive.Free / 1GB, 1)
if ($freeGB -lt 10) { throw "Only $freeGB GB free on $($drive.Name):. At least 10 GB is needed (50 GB or more recommended)." }
if ($freeGB -lt 30) { Write-Warning "Only $freeGB GB free on $($drive.Name):. Photos and backups grow every week; 50 GB or more is recommended." }
Write-Ok "$freeGB GB free on $($drive.Name):"

New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir "logs") | Out-Null
$transcript = Join-Path $InstallDir "logs\install-$(Get-Date -Format yyyy-MM-dd_HHmmss).log"
Start-Transcript -Path $transcript | Out-Null

try {
  $envPath = Join-Path $InstallDir ".env"
  $kept = Join-Path $DataDir "config\hirefolios.env" # left here by uninstall.ps1 when data is kept
  $cfg = Read-EnvFile $envPath
  if ($cfg.Count -eq 0 -and (Test-Path -LiteralPath $kept)) {
    $cfg = Read-EnvFile $kept
    Write-Ok "using the settings kept by an earlier uninstall ($kept)"
  } elseif ($cfg.Count -gt 0) {
    Write-Ok "existing settings found in $envPath (kept)"
  }
  $header = @("# Hirefolios settings, written by install.ps1. PRIVATE: holds passwords. Never email, share or commit it.",
              "# Readable only by Administrators, SYSTEM and the Hirefolios service.")
  # Writes a generated secret to the settings file at once (before it is used), so an install that
  # stops half way never loses it; a re-run reads it back.
  function Save-Setting([hashtable]$Values) {
    foreach ($k in $Values.Keys) { $cfg[$k] = $Values[$k] }
    Write-EnvFile $envPath $cfg $header
  }

  # Ports: 80/443 for Caddy, AppPort for the app (local only). Ours are fine; anything else is a blocker.
  $ours = @()
  foreach ($n in $script:AppService, $script:CaddyService) {
    $s = Get-CimInstance Win32_Service -Filter "Name='$n'" -ErrorAction SilentlyContinue
    if ($s -and $s.ProcessId) { $ours += [int]$s.ProcessId; $ours += @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($s.ProcessId)" | ForEach-Object { [int]$_.ProcessId }) }
  }
  foreach ($port in 80, 443, $AppPort) {
    $users = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $ours -notcontains $_ })
    if ($users.Count) {
      $names = ($users | ForEach-Object { if ($_ -eq 4) { "Windows web service (IIS / HTTP.sys)" } else { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName } }) -join ", "
      if ($port -eq $AppPort) { throw "Port $port is used by: $names. Run the installer again with another port, e.g. -AppPort 3080." }
      throw "Port $port is used by: $names. Hirefolios needs ports 80 and 443 on this PC. Stop or uninstall that program (for IIS: Windows Features, untick Internet Information Services), then run the installer again."
    }
  }
  Write-Ok "ports 80, 443 and $AppPort are free"

  $node = Join-Path $release "app\node\node.exe"
  $sig = Get-AuthenticodeSignature -FilePath $node
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "OpenJS Foundation") { throw "app\node\node.exe is not signed by the OpenJS Foundation ($($sig.Status)). Use an official release." }
  Write-Ok "Node.js $(& $node --version) (bundled, signed by the OpenJS Foundation)"

  # ---------------------------------------------------------------- questions
  Write-Step "Settings"
  if (-not $Domain) { $Domain = $cfg["APP_DOMAIN"] }
  if (-not $Domain) {
    $Domain = Read-Answer "Server address staff will type (press Enter for simplen.hirefolios.in)"
    if (-not $Domain) { $Domain = "simplen.hirefolios.in" }
  }
  $Domain = $Domain.ToLowerInvariant() -replace "^https?://", "" -replace "/.*$", ""
  if ($Domain -notmatch '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$') { throw "'$Domain' is not a valid address (example: simplen.hirefolios.in)." }
  if (-not $HttpsOption) { $HttpsOption = $cfg["HTTPS_OPTION"] }
  if (-not $HttpsOption) {
    Write-Host "   HTTPS: B = this PC's own certificate (default, works without internet; each office PC trusts it once)"
    Write-Host "          A = Let's Encrypt through Cloudflare (needs a Cloudflare API token and internet)"
    $HttpsOption = if ((Read-Answer "Choose A or B (press Enter for B)").ToUpperInvariant() -eq "A") { "cloudflare" } else { "internal" }
  }
  $cfToken = $cfg["CLOUDFLARE_API_TOKEN"]
  if ($HttpsOption -eq "cloudflare" -and -not $cfToken) {
    $cfToken = (Read-Secret "Cloudflare API token (Zone.DNS edit for $(($Domain -split '\.', 2)[1]))").Trim()
    if ($cfToken -notmatch '^[A-Za-z0-9_-]{30,}$') { throw "That does not look like a Cloudflare API token." }
  }
  Write-Ok "address https://$Domain, HTTPS option $(if ($HttpsOption -eq 'internal') { 'B (own certificate)' } else { 'A (Let''s Encrypt via Cloudflare)' })"

  # ---------------------------------------------------------------- PostgreSQL
  Write-Step "PostgreSQL"
  $pg = Find-PostgreSQL | Where-Object { $_.Major -ge 16 } | Select-Object -First 1
  $pgSuper = $cfg["PG_SUPERUSER_PASSWORD"]
  $pgOurs = $cfg["PG_INSTALLED_BY_HIREFOLIOS"] -eq "1"
  if (-not $pg) {
    $old = Find-PostgreSQL | Select-Object -First 1
    if ($old) { throw "PostgreSQL $($old.Version) is installed; Hirefolios needs 16 or newer. Upgrade it (or uninstall it if nothing else uses it), then run this again." }
    $pgSuper = New-Secret 24
    # Saved before PostgreSQL is installed with it: if anything fails later, a re-run still knows it.
    Save-Setting @{ PG_SUPERUSER_PASSWORD = $pgSuper }
    $pgArgs = "--mode unattended --unattendedmodeui none --superpassword $pgSuper --serverport 5432 --disable-components pgAdmin,stackbuilder"
    if ($PostgresInstaller) {
      $s = Get-AuthenticodeSignature -FilePath $PostgresInstaller
      if ($s.Status -ne "Valid" -or $s.SignerCertificate.Subject -notmatch "EnterpriseDB") { throw "$PostgresInstaller is not signed by EnterpriseDB ($($s.Status)). Download it again from enterprisedb.com." }
      Write-Note "Installing PostgreSQL from $PostgresInstaller (takes a few minutes)..."
      $p = Start-Process -FilePath $PostgresInstaller -ArgumentList $pgArgs -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "The PostgreSQL installer failed (exit $($p.ExitCode))." }
    } elseif (Get-Command winget.exe -ErrorAction SilentlyContinue) {
      Write-Note "Installing PostgreSQL 16 with winget (PostgreSQL License; takes a few minutes)..."
      & winget.exe install --id PostgreSQL.PostgreSQL.16 --exact --source winget --silent --accept-package-agreements --accept-source-agreements --override $pgArgs
      if ($LASTEXITCODE -ne 0) {
        throw "winget could not install PostgreSQL (exit $LASTEXITCODE). Without internet: on another PC download the PostgreSQL 16 Windows x86-64 installer from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads, copy it here and run: install.ps1 -PostgresInstaller <path to the .exe>"
      }
    } else {
      throw "winget is not available. Download the PostgreSQL 16 Windows x86-64 installer from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads (on any PC), copy it here and run: install.ps1 -PostgresInstaller <path to the .exe>"
    }
    $pg = Find-PostgreSQL | Where-Object { $_.Major -ge 16 } | Select-Object -First 1
    if (-not $pg) { throw "PostgreSQL was installed but cannot be found in the registry. Restart the PC and run this again." }
    $pgOurs = $true
    Save-Setting @{ PG_INSTALLED_BY_HIREFOLIOS = "1"; PG_BIN = $pg.Bin; PG_SERVICE = $pg.Service }
    Write-Ok "PostgreSQL $($pg.Version) installed"
  } else {
    Write-Ok "PostgreSQL $($pg.Version) found ($($pg.Bin))"
  }
  $pgSvc = Get-Service -Name $pg.Service
  if ($pgSvc.StartType -ne "Automatic") { Set-Service -Name $pg.Service -StartupType Automatic }
  if ($pgSvc.Status -ne "Running") { Start-Service -Name $pg.Service }

  $dbUrl = $cfg["DATABASE_URL"]
  $dbOk = $false
  if ($dbUrl) {
    $d = Get-PgConnection $dbUrl
    try { Invoke-Psql -Bin $pg.Bin -User $d.User -Password $d.Password -Database $d.Database -Sql "select 1;" | Out-Null; $dbOk = $true } catch { Write-Note "saved database login does not work any more; repairing it" }
  }
  if (-not $dbOk) {
    if (-not $pgSuper -and $PostgresSuperuserPassword) {
      $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PostgresSuperuserPassword)
      $pgSuper = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
    }
    for ($try = 1; ; $try++) {
      if (-not $pgSuper) { $pgSuper = Read-Secret "Password of the PostgreSQL 'postgres' user (set when PostgreSQL was installed)" }
      try { Invoke-Psql -Bin $pg.Bin -User postgres -Password $pgSuper -Sql "select 1;" | Out-Null; break } catch {
        if ($try -ge 3 -or $PostgresSuperuserPassword) { throw "Could not sign in to PostgreSQL as 'postgres' ($($_.Exception.Message))." }
        Write-Warning "That password did not work. Try again."
        $pgSuper = ""
      }
    }
    $dbPass = New-Secret 24
    $dbUrl = "postgres://hirefolios:$dbPass@127.0.0.1:5432/hirefolios"
    # Saved before the login gets this password, so a failure further on never leaves the app without it.
    Save-Setting @{ DATABASE_URL = $dbUrl }
    $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hirefolios') THEN CREATE ROLE hirefolios LOGIN PASSWORD '$dbPass';
  ELSE ALTER ROLE hirefolios LOGIN PASSWORD '$dbPass'; END IF;
END `$`$;
SELECT 'exists' FROM pg_database WHERE datname = 'hirefolios';
"@
    $exists = Invoke-Psql -Bin $pg.Bin -User postgres -Password $pgSuper -Sql $sql
    if (-not ($exists -match "exists")) {
      Invoke-Psql -Bin $pg.Bin -User postgres -Password $pgSuper -Sql "CREATE DATABASE hirefolios OWNER hirefolios ENCODING 'UTF8' TEMPLATE template0;" | Out-Null
      Write-Ok "database 'hirefolios' and its own login created"
    } else {
      Write-Ok "database 'hirefolios' kept; its login password was renewed"
    }
    if ($pgOurs) {
      # Our own PostgreSQL only answers this PC (an existing one is left as it is).
      Invoke-Psql -Bin $pg.Bin -User postgres -Password $pgSuper -Sql "ALTER SYSTEM SET listen_addresses = 'localhost';" | Out-Null
      Restart-Service -Name $pg.Service -Force
      Write-Ok "PostgreSQL listens on this PC only"
    }
  } else {
    Write-Ok "database login works"
  }
  if (-not $pgOurs) { $pgSuper = "" } # never keep someone else's superuser password

  # ---------------------------------------------------------------- admin account
  # A kept database (re-run, reinstall after uninstall) already has its admins: then nothing is asked.
  $needAdmin = $true
  $d = Get-PgConnection $dbUrl
  $n = Invoke-Psql -Bin $pg.Bin -User $d.User -Password $d.Password -Database $d.Database -Sql "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'users';"
  if (($n | Select-Object -First 1) -eq "1") {
    $admins = Invoke-Psql -Bin $pg.Bin -User $d.User -Password $d.Password -Database $d.Database -Sql "select count(*) from users where role = 'admin' and active;"
    $needAdmin = ($admins | Select-Object -First 1) -eq "0"
  }
  $adminPlain = ""
  if ($needAdmin) {
    Write-Step "First admin account"
    for ($try = 1; -not $AdminEmail; $try++) {
      $e = (Read-Answer "Admin email (used to sign in)").ToLowerInvariant()
      if ($e -match '^[^@\s]+@[^@\s]+\.[^@\s]+$') { $AdminEmail = $e } elseif ($try -ge 5) { throw "No valid admin email given." } else { Write-Warning "That is not an email address. Example: hr.admin@simplen.in" }
    }
    $AdminEmail = $AdminEmail.Trim().ToLowerInvariant()
    if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "'$AdminEmail' is not an email address." }
    if ($AdminPassword) {
      $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword)
      $adminPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
      if ($adminPlain.Length -lt 8 -or $adminPlain.Length -gt 128) { throw "The admin password must be 8 to 128 characters." }
    }
    for ($try = 1; -not $adminPlain; $try++) {
      $p1 = Read-Secret "Admin password (8 or more characters; it is not shown while you type)"
      if ($p1.Length -lt 8 -or $p1.Length -gt 128) { Write-Warning "The password must be 8 to 128 characters." }
      elseif ($p1 -ne (Read-Secret "Type the same password again")) { Write-Warning "The two passwords are not the same." }
      else { $adminPlain = $p1 }
      if (-not $adminPlain -and $try -ge 5) { throw "No admin password set." }
    }
  }

  # ---------------------------------------------------------------- files
  Write-Step "Copying Hirefolios $version to $InstallDir"
  $uploads = Join-Path $DataDir "uploads"
  New-Item -ItemType Directory -Force -Path $uploads, $BackupDir, (Join-Path $InstallDir "caddy\data"), (Join-Path $InstallDir "service") | Out-Null
  $appSvc = Get-Service -Name $script:AppService -ErrorAction SilentlyContinue
  if ($appSvc) { Stop-AppService }
  $caddySvc = Get-Service -Name $script:CaddyService -ErrorAction SilentlyContinue
  if ($caddySvc -and $caddySvc.Status -ne "Stopped") { Stop-Service -Name $script:CaddyService -Force }
  $appDir = Join-Path $InstallDir "app"
  if ((Resolve-Path $release).Path -ne (Resolve-Path $InstallDir -ErrorAction SilentlyContinue).Path) {
    if (Test-Path $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $release "app") -Destination $appDir -Recurse
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "scripts") | Out-Null
    Copy-Item -Path (Join-Path $release "scripts\*") -Destination (Join-Path $InstallDir "scripts") -Recurse -Force
    if (Test-Path (Join-Path $release "docs")) { Copy-Item -LiteralPath (Join-Path $release "docs") -Destination $InstallDir -Recurse -Force }
  }
  Write-Ok "app, scripts and docs copied"

  # Tools: hashes pinned in common.ps1, checked again here.
  $winsw = Join-Path $release "tools\$($script:Tools.winsw.File)"
  if ((Get-FileSha256 $winsw) -ne $script:Tools.winsw.Sha256) { throw "$winsw does not match its pinned checksum." }
  $svcExe = Join-Path $InstallDir "service\hirefolios.exe"
  Copy-Item -LiteralPath $winsw -Destination $svcExe -Force
  $caddyExe = Join-Path $InstallDir "caddy\caddy.exe"
  if ($HttpsOption -eq "internal") {
    $zip = Join-Path $release "tools\$($script:Tools.caddy.File)"
    if ((Get-FileSha256 $zip) -ne $script:Tools.caddy.Sha256) { throw "$zip does not match its pinned checksum." }
    $tmp = Join-Path $env:TEMP "hirefolios-caddy-$(New-Secret 4)"
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp
    Copy-Item -LiteralPath (Join-Path $tmp "caddy.exe") -Destination $caddyExe -Force
    Remove-Item -LiteralPath $tmp -Recurse -Force
    Write-Ok "Caddy $($script:Tools.caddy.Version) (checksum verified), WinSW $($script:Tools.winsw.Version) (checksum verified)"
  } else {
    # Let's Encrypt via Cloudflare needs the Cloudflare DNS module, built by Caddy's official download service.
    # That build has no published checksum: its SHA-256 is printed and logged for the record.
    $url = "https://caddyserver.com/api/download?os=windows&arch=amd64&version=v$($script:Tools.caddy.Version)&p=github.com%2Fcaddy-dns%2Fcloudflare"
    Write-Note "Downloading Caddy with the Cloudflare DNS module from caddyserver.com..."
    Invoke-WebRequest -Uri $url -OutFile "$caddyExe.new" -UseBasicParsing
    $mods = Invoke-Native "$caddyExe.new" @("list-modules") -Quiet
    if (-not ($mods -match "dns.providers.cloudflare")) { throw "The downloaded Caddy has no Cloudflare DNS module." }
    Move-Item -LiteralPath "$caddyExe.new" -Destination $caddyExe -Force
    Write-Ok "Caddy with Cloudflare DNS, SHA-256 $(Get-FileSha256 $caddyExe)"
  }

  # ---------------------------------------------------------------- settings file
  Write-Step "Writing $envPath"
  $values = [ordered]@{
    NODE_ENV = "production"; NEXT_TELEMETRY_DISABLED = "1"
    PORT = "$AppPort"; HOSTNAME = "127.0.0.1"
    DATABASE_URL = $dbUrl
    BETTER_AUTH_SECRET = $(if ($cfg["BETTER_AUTH_SECRET"]) { $cfg["BETTER_AUTH_SECRET"] } else { New-Secret 32 })
    BETTER_AUTH_URL = "https://$Domain"
    BETTER_AUTH_TRUSTED_ORIGINS = $cfg["BETTER_AUTH_TRUSTED_ORIGINS"]
    UPLOAD_DIR = $uploads
    RUN_MIGRATIONS = "1"; MIGRATIONS_DIR = (Join-Path $appDir "drizzle")
    SEED_ON_START = "1"
    APP_DOMAIN = $Domain; HTTPS_OPTION = $HttpsOption; CLOUDFLARE_API_TOKEN = $cfToken
    PG_BIN = $pg.Bin; PG_SERVICE = $pg.Service
    PG_INSTALLED_BY_HIREFOLIOS = $(if ($pgOurs) { "1" } else { "0" }); PG_SUPERUSER_PASSWORD = $pgSuper
    BACKUP_DIR = $BackupDir
    BACKUP_KEEP_DAYS = $(if ($cfg["BACKUP_KEEP_DAYS"]) { $cfg["BACKUP_KEEP_DAYS"] } else { "14" })
    BACKUP_COPY_DIR = $cfg["BACKUP_COPY_DIR"]
  }
  if ($needAdmin) { $values["SEED_ADMIN_EMAIL"] = $AdminEmail; $values["SEED_ADMIN_NAME"] = $AdminName; $values["SEED_ADMIN_PASSWORD"] = $adminPlain }
  Write-EnvFile $envPath $values $header
  if (Test-Path -LiteralPath $kept) { Remove-Item -LiteralPath $kept -Force } # the settings live in one place only
  Write-Ok "settings saved (secrets generated, not shown)"

  # ---------------------------------------------------------------- app service
  Write-Step "Hirefolios service"
  $xml = (Get-Content -Raw (Join-Path $PSScriptRoot "hirefolios-service.xml")).Replace("__INSTALL_DIR__", $InstallDir).Replace("__APP_PORT__", "$AppPort").Replace("__PG_SERVICE__", $pg.Service)
  [IO.File]::WriteAllText((Join-Path $InstallDir "service\hirefolios.xml"), $xml)
  if (-not (Get-Service -Name $script:AppService -ErrorAction SilentlyContinue)) {
    Invoke-Native $svcExe @("install") -Quiet | Out-Null
  }
  # Its own low-rights account (virtual service account), start on boot, restart on failure.
  Invoke-Native sc.exe @("config", $script:AppService, "obj=", "NT SERVICE\$($script:AppService)", "start=", "auto", "depend=", $pg.Service) -Quiet | Out-Null
  Invoke-Native sc.exe @("failure", $script:AppService, "reset=", "3600", "actions=", "restart/10000/restart/30000/restart/60000") -Quiet | Out-Null
  $appAcct = Get-ServiceSid $script:AppService
  $caddyAcct = Get-ServiceSid $script:CaddyService

  # ---------------------------------------------------------------- caddy service
  Write-Step "HTTPS service (Caddy)"
  $caddyDir = Join-Path $InstallDir "caddy"
  $template = if ($HttpsOption -eq "internal") { "Caddyfile.internal" } else { "Caddyfile.cloudflare" }
  $cf = (Get-Content -Raw (Join-Path $PSScriptRoot $template)).Replace("__APP_DOMAIN__", $Domain).Replace("__APP_PORT__", "$AppPort").
    Replace("__CADDY_DATA__", ((Join-Path $caddyDir "data") -replace "\\", "/")).Replace("__LOG_DIR__", ((Join-Path $InstallDir "logs") -replace "\\", "/"))
  $caddyfile = Join-Path $caddyDir "Caddyfile"
  [IO.File]::WriteAllText($caddyfile, $cf)
  $caddyArgs = "`"$caddyExe`" run --config `"$caddyfile`" --adapter caddyfile"
  if ($HttpsOption -eq "cloudflare") { $caddyArgs += " --envfile `"$envPath`"" }
  if ($HttpsOption -eq "cloudflare") { $env:CLOUDFLARE_API_TOKEN = $cfToken }
  Invoke-Native $caddyExe @("validate", "--config", $caddyfile, "--adapter", "caddyfile") -Quiet | Out-Null
  $env:CLOUDFLARE_API_TOKEN = $null
  if (Get-Service -Name $script:CaddyService -ErrorAction SilentlyContinue) {
    Invoke-Native sc.exe @("config", $script:CaddyService, "binPath=", $caddyArgs) -Quiet | Out-Null
  } else {
    New-Service -Name $script:CaddyService -BinaryPathName $caddyArgs -DisplayName "Hirefolios HTTPS (Caddy)" -StartupType Automatic -Description "HTTPS for Hirefolios: https://$Domain -> 127.0.0.1:$AppPort" | Out-Null
  }
  Invoke-Native sc.exe @("config", $script:CaddyService, "obj=", "NT SERVICE\$($script:CaddyService)", "start=", "auto") -Quiet | Out-Null
  Invoke-Native sc.exe @("failure", $script:CaddyService, "reset=", "3600", "actions=", "restart/5000/restart/10000/restart/30000") -Quiet | Out-Null
  Write-Ok "services registered (start on boot, restart on failure, own low-rights accounts)"

  # ---------------------------------------------------------------- permissions
  # C:\ lets every signed-in user change new folders; lock ours down to Administrators, SYSTEM and the services.
  Protect-Path $InstallDir -Read @($appAcct, $caddyAcct)
  Protect-Path (Join-Path $InstallDir "logs") -Modify @($appAcct, $caddyAcct)
  Protect-Path (Join-Path $caddyDir "data") -Modify @($caddyAcct)
  Protect-Path $envPath -Read @($appAcct, $(if ($HttpsOption -eq "cloudflare") { $caddyAcct }))
  Protect-Path $DataDir
  Protect-Path $uploads -Modify @($appAcct)
  Protect-Path $BackupDir
  Write-Ok "folders readable only by Administrators, SYSTEM and the services"

  # ---------------------------------------------------------------- start
  Write-Step "Starting Hirefolios (first start runs the database set-up)"
  Start-Service -Name $script:AppService
  $health = Wait-Health "http://127.0.0.1:$AppPort/api/health" -Seconds 180 -Version $version
  if (-not $health) {
    $err = Get-ChildItem (Join-Path $InstallDir "logs") -Filter "hirefolios*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 2
    foreach ($f in $err) { Write-Host "--- $($f.Name) (last lines)"; Get-Content -LiteralPath $f.FullName -Tail 20 }
    throw "Hirefolios did not start. The log lines above say why; full logs are in $InstallDir\logs."
  }
  Write-Ok "app is running (version $($health.version), database ok)"

  Write-Step "Starting HTTPS"
  & (Join-Path $PSScriptRoot "set-hosts.ps1") -ServerIp 127.0.0.1 -Name $Domain | Out-Null
  Write-Ok "this PC finds $Domain at 127.0.0.1 (hosts file)"
  Start-Service -Name $script:CaddyService
  $fingerprint = ""
  if ($HttpsOption -eq "internal") {
    $root = Join-Path $caddyDir "data\pki\authorities\local\root.crt"
    for ($i = 0; $i -lt 30 -and -not (Test-Path $root); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Path $root)) { throw "Caddy did not create its certificate. See $InstallDir\logs\caddy.log." }
    $publicCrt = Join-Path $InstallDir "hirefolios-root.crt"
    Copy-Item -LiteralPath $root -Destination $publicCrt -Force
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($publicCrt)
    $fingerprint = Get-CertFingerprint $cert
    [IO.File]::WriteAllText((Join-Path $InstallDir "certificate-fingerprint.txt"), "Hirefolios certificate fingerprint (SHA-256), compare on every PC:`r`n$fingerprint`r`n")
    & (Join-Path $PSScriptRoot "trust-certificate.ps1") -CertFile $publicCrt -Fingerprint $fingerprint | Out-Null
    Write-Ok "certificate created and trusted on this PC"
  }
  $https = Wait-Health "https://$Domain/api/health" -Seconds $(if ($HttpsOption -eq "internal") { 60 } else { 240 })
  if (-not $https) { throw "https://$Domain does not answer. See $InstallDir\logs\caddy.log$(if ($HttpsOption -eq 'cloudflare') { ' (check the Cloudflare token and the internet connection)' })." }
  Write-Ok "https://$Domain answers"

  # ---------------------------------------------------------------- admin check, then forget the password
  if ($needAdmin) {
    $body = @{ email = $AdminEmail; password = $adminPlain } | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "https://$Domain/api/auth/sign-in/email" -Method Post -Body $body -ContentType "application/json" -Headers @{ Origin = "https://$Domain" } -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "The new admin account could not sign in (HTTP $($r.StatusCode))." }
    Write-Ok "admin $AdminEmail can sign in"
  }
  # The admin exists now: take the password out of the settings file and stop seeding on start.
  $values.Remove("SEED_ADMIN_EMAIL"); $values.Remove("SEED_ADMIN_NAME"); $values.Remove("SEED_ADMIN_PASSWORD")
  $values["SEED_ON_START"] = "0"
  Write-EnvFile $envPath $values $header
  Protect-Path $envPath -Read @($appAcct, $(if ($HttpsOption -eq "cloudflare") { $caddyAcct }))
  $adminPlain = ""

  # ---------------------------------------------------------------- network
  Write-Step "Network"
  Get-NetFirewallRule -Group $script:FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName "Hirefolios web (HTTP, HTTPS)" -Group $script:FirewallGroup -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 80, 443 -Program $caddyExe -Profile Private | Out-Null
  Write-Ok "firewall: ports 80 and 443 open for Caddy on private networks only"
  foreach ($p in Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq "Public" }) {
    Write-Warning "Windows treats the network '$($p.Name)' as Public, so other PCs cannot reach Hirefolios."
    if ((Read-Answer "Is '$($p.Name)' your office network? Mark it Private (Y/N)").ToUpperInvariant() -eq "Y") {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
      Write-Ok "'$($p.Name)' is now a private network"
    }
  }
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -ExpandProperty IPAddress)

  # ---------------------------------------------------------------- backups
  if (-not $SkipBackupTask) {
    Write-Step "Daily backup"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\scripts\backup.ps1`""
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday, Saturday -At "18:15"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $script:BackupTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Ok "backup at 6:15 pm Monday to Saturday into $BackupDir (runs at the next start if the PC was off)"
  }

  # ---------------------------------------------------------------- done
  $mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
  Write-Host ""
  Write-Host "=====================================================================" -ForegroundColor Green
  Write-Host " Hirefolios $version is installed and running ($mins min)." -ForegroundColor Green
  Write-Host "=====================================================================" -ForegroundColor Green
  Write-Host " Open:            https://$Domain"
  Write-Host " This PC's address on the network: $($ips -join ', ')  (reserve it in the router)"
  if ($fingerprint) {
    Write-Host " Certificate fingerprint (write it down; compare it on every PC):"
    Write-Host "   $fingerprint" -ForegroundColor Yellow
    Write-Host " On every other office PC (as Administrator), from the scripts folder:"
    Write-Host "   set-hosts.ps1 -ServerIp $(if ($ips) { $ips[0] } else { '<this PC address>' })   (skip if the router does the DNS)"
    Write-Host "   trust-certificate.ps1 -Server $Domain"
  }
  Write-Host " Settings: $envPath (private)   Logs: $InstallDir\logs   Backups: $BackupDir"
  Write-Host " Nothing needs starting by hand: all three services start when Windows starts."
  Write-Host ""
} finally {
  Stop-Transcript | Out-Null
}
