# Starts the bot's PM2 runtime and stays alive while it runs. Meant for a Scheduled Task at boot (README, "Windows").
#   -RequireAdmin  refuse to start unless this process is elevated
#   -Node <path>   node.exe to use, when it is not on the task's PATH
param([switch]$RequireAdmin, [string]$Node)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($RequireAdmin -and -not $elevated) { throw 'Started without administrator privileges, and -RequireAdmin was given.' }
if (-not $Node) { $Node = (Get-Command node.exe).Source }
$logs = Join-Path $repoRoot 'data/pm2'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
# Who the task really ran as: the first thing to check when the agent lacks a login or a permission.
@{ user = $identity.Name; elevated = $elevated; startedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'startup-identity.json') -Encoding UTF8
$runtime = Start-Process -FilePath $Node -ArgumentList @("`"$PSScriptRoot/pm2-windows.cjs`"", 'run') `
    -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'startup.log') -RedirectStandardError (Join-Path $logs 'startup-error.log')
$runtime.WaitForExit()
exit $runtime.ExitCode
