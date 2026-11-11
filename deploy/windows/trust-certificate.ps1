# HTTPS option B: makes this PC trust the Hirefolios server's own certificate, so Chrome and Edge open
# https://simplen.hirefolios.in without a warning (and allow the webcam). Run ONCE on every office PC,
# as Administrator. Works on its own: copy just this file to the PC.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File trust-certificate.ps1 -Server simplen.hirefolios.in
#   powershell -NoProfile -ExecutionPolicy Bypass -File trust-certificate.ps1 -CertFile E:\hirefolios-root.crt
#
# The certificate is fetched from the server (or a USB copy) and its fingerprint is shown: compare it with the
# fingerprint install.ps1 printed on the server (also in C:\hirefolios\certificate-fingerprint.txt there).
# Remove again: -Remove. Firefox: about:config -> security.enterprise_roots.enabled = true.
[CmdletBinding()]
param(
  [string]$Server = "",
  [string]$CertFile = "",
  # Full fingerprint to compare automatically (install.ps1 uses this on the server itself).
  [string]$Fingerprint = "",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this as Administrator: right-click PowerShell, choose 'Run as administrator'." }

function Get-Fp($cert) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hex = -join ($sha.ComputeHash($cert.RawData) | ForEach-Object { $_.ToString("X2") })
  return ($hex -split "(.{4})" | Where-Object { $_ }) -join " "
}
$store = New-Object Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")

if ($Remove) {
  $store.Open("ReadWrite")
  $ours = @($store.Certificates | Where-Object { $_.Subject -like "*Caddy Local Authority*" })
  foreach ($c in $ours) { $store.Remove($c); Write-Host "Removed: $($c.Subject) ($(Get-Fp $c))" }
  $store.Close()
  if (-not $ours) { Write-Host "No Hirefolios (Caddy) certificate was trusted on this PC." }
  exit 0
}

if (-not $CertFile) {
  if (-not $Server) { $Server = "$(Read-Host "Server address (press Enter for simplen.hirefolios.in)")".Trim(); if (-not $Server) { $Server = "simplen.hirefolios.in" } }
  $Server = $Server -replace "^https?://", "" -replace "/.*$", ""
  $CertFile = Join-Path $env:TEMP "hirefolios-root.crt"
  try {
    Invoke-WebRequest -Uri "http://$Server/hirefolios-root.crt" -OutFile $CertFile -UseBasicParsing -TimeoutSec 15
  } catch {
    throw "Could not reach http://$Server ($($_.Exception.Message)). Check this PC finds the server (set-hosts.ps1 or router DNS) and that the server is on, or copy C:\hirefolios\hirefolios-root.crt from the server on a USB stick and use -CertFile."
  }
}
$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path -LiteralPath $CertFile).Path)
$isCa = $cert.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] -and $_.CertificateAuthority }
if (-not $isCa -or $cert.Subject -notlike "*Caddy Local Authority*") { throw "This is not a Hirefolios (Caddy) root certificate: $($cert.Subject)" }
$fp = Get-Fp $cert

Write-Host ""
Write-Host "Certificate:  $($cert.Subject)"
Write-Host "Valid until:  $($cert.NotAfter.ToString('d MMM yyyy'))"
Write-Host "Fingerprint:  $fp" -ForegroundColor Yellow
Write-Host ""
if ($Fingerprint) {
  if (($Fingerprint -replace "\s", "").ToUpperInvariant() -ne ($fp -replace "\s", "")) { throw "The fingerprint does not match the one given. Nothing was changed." }
} else {
  Write-Host "Compare it with the fingerprint printed on the server (C:\hirefolios\certificate-fingerprint.txt)."
  $last = ($fp -replace "\s", "").Substring(60)
  $typed = "$(Read-Host "If they are the same, type the LAST 4 characters of the fingerprint (anything else cancels)")".Trim().ToUpperInvariant()
  if ($typed -ne $last) { Write-Host "Cancelled. Nothing was changed."; exit 1 }
}

$store.Open("ReadWrite")
if ($store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }) {
  Write-Host "Already trusted on this PC. Nothing to do." -ForegroundColor Green
} else {
  $store.Add($cert)
  Write-Host "Done: this PC now trusts the Hirefolios server. Close and reopen Chrome / Edge." -ForegroundColor Green
}
$store.Close()
