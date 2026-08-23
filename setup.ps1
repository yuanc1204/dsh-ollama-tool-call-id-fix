# setup.ps1 — one-click installer for the dsh-ollama-call-id-auto DSH plugin.
#
# Copies the plugin/ directory into the DSH custom-plugins partition and
# registers it in the web profile (pnpm link + bundle reconcile). Re-runnable.
#
# Usage:
#   .\setup.ps1                # install for the default "web" profile
#   .\setup.ps1 -Profile headless   # install for another profile
#
# After installing, restart DeepSeek Harness. On the next boot you should see
# in the log (stderr):
#   [dsh-ollama-call-id-auto] patched: …\openai-completions.js
# or, on subsequent boots:
#   [dsh-ollama-call-id-auto] already patched, skipping: …
[CmdletBinding()]
param(
    [string]$Profile = "web"
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginSrc = Join-Path $here "plugin"
if (-not (Test-Path (Join-Path $pluginSrc "package.json"))) {
    throw "plugin/ not found next to setup.ps1 (expected: $pluginSrc)"
}

# 1) Copy the plugin into the DSH custom-plugins partition.
$customRoot = Join-Path $env:USERPROFILE ".dsh\custom-plugins"
$target = Join-Path $customRoot "dsh-ollama-call-id-auto"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $pluginSrc "*") $target -Recurse -Force
Write-Host "Copied plugin to: $target"

# 2) Register it in the selected profile (forward slashes for the link: spec).
$linkTarget = ($target -replace '\\', '/')
& dsh plugin --profile $Profile "add" "link:$linkTarget"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Done. Restart DeepSeek Harness (or start a new conversation) to activate."
Write-Host "Verify with: dsh --profile $Profile   (look for the [dsh-ollama-call-id-auto] line in the log)"
Write-Host "To uninstall: dsh plugin --profile $Profile remove dsh-ollama-call-id-auto"
