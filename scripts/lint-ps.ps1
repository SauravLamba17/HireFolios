# npm run lint:ps - checks every PowerShell script in deploy/windows and scripts/ the way the office PC runs them
# (Windows PowerShell 5.1): parse errors, "$name:" inside strings (read as a drive variable, often silently),
# non-ASCII characters (5.1 reads BOM-less files as ANSI), then PSScriptAnalyzer if the module is installed.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$files = @(Get-ChildItem (Join-Path $repo "deploy\windows"), (Join-Path $repo "scripts") -Filter *.ps1 | ForEach-Object FullName)
$problems = @()
foreach ($f in $files) {
  $tokens = $null; $errs = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errs)
  foreach ($x in $errs) { $problems += "$(Split-Path -Leaf $f):$($x.Extent.StartLineNumber) parse error: $($x.Message)" }
  $drive = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.IsDriveQualified -and $n.VariablePath.DriveName -notin "env", "variable", "function", "alias" }, $true)
  foreach ($d in $drive) { $problems += "$(Split-Path -Leaf $f):$($d.Extent.StartLineNumber) '$($d.Extent.Text)' is read as a drive variable: write `${name}: or `$(`$name):" }
  $n = 0
  foreach ($line in [IO.File]::ReadAllLines($f)) { $n++; if ($line -match '[^\x00-\x7F]') { $problems += "$(Split-Path -Leaf $f):$n non-ASCII character" } }
}
if (Get-Module -ListAvailable PSScriptAnalyzer) {
  Import-Module PSScriptAnalyzer
  $settings = Join-Path $repo "deploy\windows\PSScriptAnalyzerSettings.psd1"
  foreach ($r in Invoke-ScriptAnalyzer -Path $files[0..($files.Count - 1)] -Settings $settings) { $problems += "$($r.ScriptName):$($r.Line) $($r.RuleName): $($r.Message)" }
  $pssa = "PSScriptAnalyzer run"
} else { $pssa = "PSScriptAnalyzer not installed (skipped)" }
if ($problems) { $problems | ForEach-Object { Write-Host $_ }; Write-Host "lint:ps FAILED ($($problems.Count))"; exit 1 }
Write-Host "lint:ps passed: $($files.Count) scripts, no parse errors, no drive-variable strings, ASCII only; $pssa"
