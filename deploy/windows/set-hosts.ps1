# Tells this PC where the Hirefolios server is, by adding one line to the Windows hosts file:
#   192.168.1.20  simplen.hirefolios.in  # hirefolios
# Not needed when the office router answers simplen.hirefolios.in itself (see docs\INSTALL.md, "Router DNS").
# Run on every office PC, as Administrator. Works on its own: copy just this file to the PC.
#   powershell -NoProfile -ExecutionPolicy Bypass -File set-hosts.ps1 -ServerIp 192.168.1.20
#   powershell -NoProfile -ExecutionPolicy Bypass -File set-hosts.ps1 -Remove
[CmdletBinding()]
param(
  [string]$ServerIp = "",
  [string]$Name = "simplen.hirefolios.in",
  [switch]$Remove,
  [string]$HostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and $HostsFile -like "$env:SystemRoot*") { throw "Run this as Administrator: right-click PowerShell, choose 'Run as administrator'." }

$Name = $Name.Trim().ToLowerInvariant()
$mark = "# hirefolios"
$lines = @()
if (Test-Path -LiteralPath $HostsFile) { $lines = @([IO.File]::ReadAllLines($HostsFile)) }
# Drop our earlier line for this name (only lines this script wrote carry the marker).
$keep = @($lines | Where-Object { -not ($_ -match [regex]::Escape($mark) + '\s*$' -and ($_ -split '\s+') -contains $Name) })

if (-not $Remove) {
  if (-not $ServerIp) { $ServerIp = "$(Read-Host "The server PC's address (e.g. 192.168.1.20)")".Trim() }
  $ip = $null
  if (-not [Net.IPAddress]::TryParse($ServerIp, [ref]$ip) -or $ip.AddressFamily -ne "InterNetwork") { throw "'$ServerIp' is not an IPv4 address like 192.168.1.20." }
  $keep += "$ServerIp`t$Name`t$mark"
}
# The hosts file is plain ASCII; write it in one go.
[IO.File]::WriteAllLines($HostsFile, [string[]]$keep, [Text.Encoding]::ASCII)
if ($HostsFile -like "$env:SystemRoot*") { ipconfig.exe /flushdns | Out-Null }
if ($Remove) { Write-Host "Removed $Name from the hosts file." } else { Write-Host "This PC now finds $Name at $ServerIp." -ForegroundColor Green }
