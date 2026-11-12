# Hirefolios: is this PC ready to be the server? Run BEFORE install.ps1. No admin needed; it changes nothing.
#   powershell -NoProfile -ExecutionPolicy Bypass -File check-machine.ps1
# Prints PASS / WARN / FAIL for each item with what to do, and saves a report file (on the Desktop) to send to
# your developer. Fix every FAIL before installing; read every WARN. Works on its own (copy just this file),
# and reads versions.json when it sits next to it.
[CmdletBinding()]
param([string]$OutFile = "")
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$pgMajor = 16
$pins = Join-Path $PSScriptRoot "versions.json"
if ($PSScriptRoot -and (Test-Path -LiteralPath $pins)) { try { $pgMajor = [int](Get-Content -Raw -LiteralPath $pins | ConvertFrom-Json).postgresql.major } catch { Write-Verbose "versions.json unreadable" } }

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Status, [string]$Item, [string]$Found, [string]$Fix = "") {
  $results.Add([pscustomobject]@{ Status = $Status; Item = $Item; Found = $Found; Fix = $Fix })
  $color = @{ PASS = "Green"; WARN = "Yellow"; FAIL = "Red"; INFO = "Gray" }[$Status]
  Write-Host ("{0,-5} {1}: {2}" -f $Status, $Item, $Found) -ForegroundColor $color
  if ($Fix -and $Status -ne "PASS") { Write-Host "      -> $Fix" }
}
function Get-Safe([scriptblock]$Block) { try { & $Block } catch { $null } }

Write-Host ""
Write-Host "Hirefolios machine check - $env:COMPUTERNAME - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- Windows
$os = Get-Safe { Get-CimInstance Win32_OperatingSystem }
$build = [Environment]::OSVersion.Version.Build
$caption = if ($os) { $os.Caption } else { "Windows" }
if ([Environment]::OSVersion.Version.Major -ge 10 -and $build -ge 17763) { Add-Result PASS "Windows" "$caption, build $build" }
else { Add-Result FAIL "Windows" "$caption, build $build" "Windows 10 version 1809 or later, or Windows 11, is needed. Run Windows Update." }
if ([Environment]::Is64BitOperatingSystem) { Add-Result PASS "64-bit Windows" "yes" } else { Add-Result FAIL "64-bit Windows" "32-bit" "Hirefolios needs 64-bit Windows." }
$psv = $PSVersionTable.PSVersion
if ($psv.Major -ge 5) { Add-Result PASS "PowerShell" "$psv" } else { Add-Result FAIL "PowerShell" "$psv" "Windows PowerShell 5.1 is needed (part of Windows 10/11)." }
$net = Get-Safe { [int](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" -Name Release).Release }
if ($net -ge 394254) { Add-Result PASS ".NET Framework 4.6.1+ (for the service wrapper)" "release $net" } else { Add-Result FAIL ".NET Framework 4.6.1+" "$net" "Run Windows Update (it brings .NET Framework 4.8)." }
if (Test-Path (Join-Path $env:SystemRoot "System32\tar.exe")) { Add-Result PASS "tar.exe (for backups)" "present" } else { Add-Result FAIL "tar.exe" "missing" "Windows 10 1803 or later includes it: run Windows Update." }

# ---------------------------------------------------------------- hardware
$cpu = Get-Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 }
if ($cpu) {
  $cores = [int]$cpu.NumberOfCores
  if ($cores -ge 4) { Add-Result PASS "CPU" "$($cpu.Name.Trim()), $cores cores" } else { Add-Result WARN "CPU" "$($cpu.Name.Trim()), $cores cores" "4 or more cores recommended; it will work, but slower on busy drive days." }
}
$ramGB = if ($os) { [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) } else { 0 }
if ($ramGB -ge 15) { Add-Result PASS "Memory" "$ramGB GB" }
elseif ($ramGB -ge 7.5) { Add-Result PASS "Memory" "$ramGB GB (16 GB recommended)" }
else { Add-Result FAIL "Memory" "$ramGB GB" "At least 8 GB of memory is needed (16 GB recommended)." }
$c = Get-Safe { Get-PSDrive -Name C }
if ($c) {
  $freeGB = [math]::Round($c.Free / 1GB, 1)
  if ($freeGB -ge 50) { Add-Result PASS "Free disk (drive C)" "$freeGB GB" } elseif ($freeGB -ge 20) { Add-Result WARN "Free disk (drive C)" "$freeGB GB" "50 GB free is recommended: photos, CVs and backups grow every week. Free some space." }
  else { Add-Result FAIL "Free disk (drive C)" "$freeGB GB" "At least 50 GB free is needed. Free space or use a bigger disk." }
}
$media = Get-Safe {
  $disk = Get-Partition -DriveLetter C | Get-Disk
  (Get-PhysicalDisk | Where-Object { $_.DeviceId -eq "$($disk.Number)" }).MediaType
}
if ("$media" -eq "SSD") { Add-Result PASS "Disk type (drive C)" "SSD" }
elseif ("$media" -eq "HDD") { Add-Result WARN "Disk type (drive C)" "hard disk (HDD)" "An SSD is strongly recommended: searches, backups and start-up are much faster." }
else { Add-Result INFO "Disk type (drive C)" "could not tell ($media)" }

# ---------------------------------------------------------------- settings
$tz = Get-Safe { Get-TimeZone }
if ($tz.Id -eq "India Standard Time") { Add-Result PASS "Time zone" $tz.DisplayName } else { Add-Result FAIL "Time zone" "$($tz.Id)" "Settings > Time & language > Date & time: time zone (UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi." }
function Get-PowerIndex([string]$Setting) {
  $vals = @(powercfg.exe /query SCHEME_CURRENT SUB_SLEEP $Setting 2>$null | Select-String -Pattern "0x([0-9a-fA-F]{8})\s*$" | ForEach-Object { [Convert]::ToInt32($_.Matches[0].Groups[1].Value, 16) })
  if ($vals.Count -ge 2) { return $vals[$vals.Count - 2] } # AC (plugged in) value; the last one is battery
  return $null
}
$sleep = Get-PowerIndex "STANDBYIDLE"; $hib = Get-PowerIndex "HIBERNATEIDLE"
if ($sleep -eq 0 -and ($hib -eq 0 -or $null -eq $hib)) { Add-Result PASS "Sleep / hibernate (plugged in)" "never" }
elseif ($null -eq $sleep) { Add-Result WARN "Sleep / hibernate" "could not read" "Settings > System > Power: Sleep = Never." }
else { Add-Result FAIL "Sleep / hibernate (plugged in)" "sleep after $([math]::Round($sleep/60)) min, hibernate after $(if ($hib) { [math]::Round($hib/60) } else { 0 }) min" "Settings > System > Power: Sleep = Never (the screen may still turn off). A sleeping server stops Hirefolios for everyone." }

# ---------------------------------------------------------------- network
$profiles = @(Get-Safe { Get-NetConnectionProfile })
foreach ($p in $profiles) {
  if ("$($p.NetworkCategory)" -in "Private", "DomainAuthenticated") { Add-Result PASS "Network '$($p.Name)'" "$($p.NetworkCategory)" }
  else { Add-Result WARN "Network '$($p.Name)'" "$($p.NetworkCategory)" "If this is the office network: Settings > Network > (this network) > Private. On Public, other PCs cannot reach Hirefolios (the installer offers to change it)." }
}
if (-not $profiles) { Add-Result FAIL "Network" "not connected" "Connect the PC to the office network (a cable is best)." }
$ifs = @(Get-Safe { Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected | Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet|VirtualBox|VMware|WSL" } })
foreach ($i in $ifs) {
  $ip = (Get-Safe { Get-NetIPAddress -InterfaceIndex $i.ifIndex -AddressFamily IPv4 } | Select-Object -First 1).IPAddress
  $kind = Get-Safe { (Get-NetAdapter -InterfaceIndex $i.ifIndex).MediaType }
  $wifi = "$kind" -match "802.11|Wireless"
  if ("$($i.Dhcp)" -eq "Disabled") { Add-Result PASS "Address of '$($i.InterfaceAlias)'" "$ip (fixed)" }
  else { Add-Result WARN "Address of '$($i.InterfaceAlias)'" "$ip (from the router, DHCP)" "In the router, reserve this address for this PC (DHCP reservation), so other PCs always find it." }
  if ($wifi) { Add-Result WARN "Connection '$($i.InterfaceAlias)'" "Wi-Fi" "A network cable is more reliable for the server PC." }
}
foreach ($port in 80, 443, 3000, 5432) {
  $l = @(Get-Safe { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop })
  if (-not $l) { Add-Result PASS "Port $port" "free" ; continue }
  $owners = ($l | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -eq 4) { "Windows web service (IIS / HTTP.sys)" } else { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName } }) -join ", "
  if ($port -eq 5432 -and $owners -match "postgres") { Add-Result INFO "Port 5432" "used by PostgreSQL ($owners)" "Fine if it is PostgreSQL ${pgMajor}: the installer uses it and asks for its 'postgres' password." }
  elseif ($port -eq 3000) { Add-Result WARN "Port 3000" "used by $owners" "Install with another app port, e.g. install.ps1 -AppPort 3080." }
  else { Add-Result FAIL "Port $port" "used by $owners" "Hirefolios needs ports 80 and 443. Stop or uninstall that program (IIS: Windows Features, untick Internet Information Services)." }
}

# ---------------------------------------------------------------- software already here
$pgs = @(Get-ChildItem "HKLM:\SOFTWARE\PostgreSQL\Installations" -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath })
if (-not $pgs) { Add-Result PASS "PostgreSQL" "not installed (the installer adds PostgreSQL $pgMajor)" }
foreach ($p in $pgs) {
  $maj = [int](("$($p.Version)" -split "\.")[0])
  if ($maj -eq $pgMajor) { Add-Result INFO "PostgreSQL" "$($p.Version) installed ($($p.'Service ID'))" "The installer will use it; have its 'postgres' password ready." }
  else { Add-Result WARN "PostgreSQL" "$($p.Version) installed" "Hirefolios needs PostgreSQL $pgMajor. The installer adds $pgMajor next to it only if port 5432 is free; otherwise ask your developer." }
}
$node = Get-Safe { (& node.exe --version) 2>$null }
if ($node) { Add-Result INFO "Node.js" "$node in PATH (not used: Hirefolios brings its own)" } else { Add-Result PASS "Node.js" "not needed (Hirefolios brings its own)" }
if (Get-Command winget.exe -ErrorAction SilentlyContinue) { Add-Result PASS "winget (installs PostgreSQL)" "present" } else { Add-Result WARN "winget" "missing" "Install 'App Installer' from the Microsoft Store, or download the PostgreSQL $pgMajor installer and use install.ps1 -PostgresInstaller." }
$av = @(Get-Safe { Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct })
foreach ($a in $av) {
  if ($a.displayName -match "Windows Defender|Microsoft Defender") { Add-Result PASS "Antivirus" $a.displayName }
  else { Add-Result WARN "Antivirus" $a.displayName "Some antivirus programs block new services or ports 80/443. If the install or other PCs fail, allow C:\hirefolios and C:\Program Files\PostgreSQL in it." }
}
if (-not $av) { Add-Result INFO "Antivirus" "could not read (Windows Server or no Security Center)" }

# ---------------------------------------------------------------- devices and browsers
$cams = @(Get-Safe { Get-PnpDevice -PresentOnly -Class Camera, Image -ErrorAction Stop | Where-Object { $_.Status -eq "OK" } })
if ($cams) { Add-Result PASS "Webcam" (($cams | ForEach-Object FriendlyName) -join "; ") "Only needed on the HR desk PC." }
else { Add-Result INFO "Webcam" "none found" "Only the HR desk PC needs one (run this check there too). Plug in the USB webcam and run again." }
function Get-BrowserVersion([string[]]$Paths) {
  foreach ($p in $Paths) { if (Test-Path -LiteralPath $p) { return (Get-Item -LiteralPath $p).VersionInfo.ProductVersion } }
  return $null
}
$browsers = @{
  "Google Chrome" = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  "Microsoft Edge" = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
}
$anyBrowser = $false
foreach ($name in $browsers.Keys) {
  $v = Get-BrowserVersion $browsers[$name]
  if (-not $v) { Add-Result INFO $name "not installed"; continue }
  $anyBrowser = $true
  if ([int]($v -split "\.")[0] -ge 120) { Add-Result PASS $name $v } else { Add-Result WARN $name $v "Update it (Help > About)." }
}
if (-not $anyBrowser) { Add-Result FAIL "Browser" "neither Chrome nor Edge" "Install Google Chrome or use Microsoft Edge (part of Windows)." }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Result INFO "Run as Administrator now" "$isAdmin" "Not needed for this check; install.ps1 needs it."

# ---------------------------------------------------------------- summary + report file
$fail = @($results | Where-Object Status -eq "FAIL").Count
$warn = @($results | Where-Object Status -eq "WARN").Count
Write-Host ""
if ($fail) { Write-Host "$fail item(s) FAIL: fix them before installing. $warn warning(s)." -ForegroundColor Red }
else { Write-Host "Ready to install ($warn warning(s) to read)." -ForegroundColor Green }
if (-not $OutFile) {
  $desk = [Environment]::GetFolderPath("Desktop")
  if (-not $desk) { $desk = $env:TEMP }
  $OutFile = Join-Path $desk "hirefolios-machine-check-$env:COMPUTERNAME-$(Get-Date -Format yyyy-MM-dd_HHmm).txt"
}
$lines = @("Hirefolios machine check", "PC: $env:COMPUTERNAME", "When: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "Result: $fail FAIL, $warn WARN", "")
$lines += $results | ForEach-Object { "{0,-5} {1}: {2}{3}" -f $_.Status, $_.Item, $_.Found, $(if ($_.Fix -and $_.Status -ne "PASS") { "`r`n      -> $($_.Fix)" } else { "" }) }
[IO.File]::WriteAllLines($OutFile, [string[]]$lines)
Write-Host "Report saved: $OutFile (send this file to your developer)"
if ($fail) { exit 1 }
