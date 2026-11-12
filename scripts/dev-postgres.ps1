# Developer PC only: a permanent PostgreSQL (same major as the office, deploy/windows/versions.json) as a Windows
# service on port 5432, with a dev database + its own login. Run once, in PowerShell as Administrator, from the repo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-postgres.ps1
# Then, as yourself (not Administrator):  npm run db:migrate; npm run db:seed; npm run db:check
# Passwords are generated and written only to the repo's .env (DATABASE_URL, DEV_PG_SUPERUSER_PASSWORD), never shown.
# Safe to re-run: keeps what exists, repairs the login if .env lost it.
[CmdletBinding()]
param([string]$Database = "hirefolios_dev", [string]$Role = "hirefolios_dev")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
. (Join-Path $PSScriptRoot "..\deploy\windows\common.ps1")
Assert-Admin
$repo = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repo ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "$envPath not found: copy .env.example to .env first." }

# Changes or adds KEY=value lines in .env, keeping every other line (comments too) as it is.
function Set-DevEnv([hashtable]$Values) {
  $lines = [Collections.Generic.List[string]]([IO.File]::ReadAllLines($envPath))
  foreach ($k in $Values.Keys) {
    $i = [Array]::FindIndex($lines.ToArray(), [Predicate[string]] { param($l) $l -match "^\s*$k\s*=" })
    if ($i -ge 0) { $lines[$i] = "$k=$($Values[$k])" } else { $lines.Add("$k=$($Values[$k])") }
  }
  [IO.File]::WriteAllLines($envPath, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
}
$cfg = Read-EnvFile $envPath

Write-Step "PostgreSQL $($script:PgMajor)"
$pg = Find-PostgreSQL | Where-Object { $_.Major -eq $script:PgMajor } | Select-Object -First 1
$super = $cfg["DEV_PG_SUPERUSER_PASSWORD"]
if (-not $pg) {
  if (@(Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue).Count) { throw "Port 5432 is already in use by another program; stop it first." }
  $super = New-Secret 24
  Set-DevEnv @{ DEV_PG_SUPERUSER_PASSWORD = $super } # saved before PostgreSQL gets it
  $pgArgs = "--mode unattended --unattendedmodeui none --superpassword $super --serverport 5432 --disable-components pgAdmin,stackbuilder"
  Write-Note "Installing with winget ($($script:Versions.postgresql.wingetId)); a few minutes..."
  & winget.exe install --id $script:Versions.postgresql.wingetId --exact --source winget --silent --accept-package-agreements --accept-source-agreements --override $pgArgs
  if ($LASTEXITCODE -ne 0) { throw "winget could not install PostgreSQL (exit $LASTEXITCODE)." }
  $pg = Find-PostgreSQL | Where-Object { $_.Major -eq $script:PgMajor } | Select-Object -First 1
  if (-not $pg) { throw "PostgreSQL was installed but is not in the registry; restart and run this again." }
  Invoke-Psql -Bin $pg.Bin -User postgres -Password $super -Sql "ALTER SYSTEM SET listen_addresses = 'localhost';" | Out-Null
  Restart-Service -Name $pg.Service -Force
  Write-Ok "PostgreSQL $($pg.Version) installed as service $($pg.Service), localhost:5432 only"
} else {
  Write-Ok "PostgreSQL $($pg.Version) already installed ($($pg.Service))"
  if (-not $super) { $super = Read-Secret "Password of the PostgreSQL 'postgres' user" }
}
if ((Get-Service $pg.Service).StartType -ne "Automatic") { Set-Service $pg.Service -StartupType Automatic }
if ((Get-Service $pg.Service).Status -ne "Running") { Start-Service $pg.Service }

Write-Step "Dev database"
$works = $false
if ($cfg["DATABASE_URL"] -match "/$Database$") {
  $d = Get-PgConnection $cfg["DATABASE_URL"]
  try { Invoke-Psql -Bin $pg.Bin -User $d.User -Password $d.Password -Database $Database -Sql "select 1;" | Out-Null; $works = $true } catch { Write-Note "saved login does not work; renewing it" }
}
if (-not $works) {
  $pw = New-Secret 24
  Set-DevEnv @{ DATABASE_URL = "postgres://${Role}:$pw@localhost:5432/$Database" } # saved before the login gets it
  $sql = "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$Role') THEN CREATE ROLE $Role LOGIN PASSWORD '$pw'; ELSE ALTER ROLE $Role LOGIN PASSWORD '$pw'; END IF; END `$`$;`nSELECT 'exists' FROM pg_database WHERE datname = '$Database';"
  $exists = Invoke-Psql -Bin $pg.Bin -User postgres -Password $super -Sql $sql
  if (-not ($exists -match "exists")) {
    Invoke-Psql -Bin $pg.Bin -User postgres -Password $super -Sql "CREATE DATABASE $Database OWNER $Role ENCODING 'UTF8' TEMPLATE template0;" | Out-Null
  }
  Write-Ok "database '$Database' with its own login '$Role'; DATABASE_URL updated in .env (password not shown)"
} else {
  Write-Ok "DATABASE_URL in .env already works"
}
Write-Host ""
Write-Host "Done. Now, NOT as Administrator:  npm run db:migrate ; npm run db:seed ; npm run db:check" -ForegroundColor Green
