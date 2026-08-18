$ErrorActionPreference = 'Stop'

$adapterPath = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\node_modules\@earendil-works\pi-ai\dist\api\openai-completions.js'
$backupPath = "$adapterPath.dsh-call-id.bak"

if (-not (Test-Path -LiteralPath $adapterPath)) {
    throw "DSH adapter not found: $adapterPath"
}

$content = Get-Content -LiteralPath $adapterPath -Raw

if ($content.Contains('const toolCallIdPrefix = `dsh_${Date.now().toString(36)}_')) {
    Write-Host 'Already patched.'
    exit 0
}

$replacements = @(
    @(
        '            const pendingReasoningDetailsByToolCallId = new Map();',
        @'
            const pendingReasoningDetailsByToolCallId = new Map();
            // Ollama may repeat IDs such as "call_0" across requests. Persisted
            // conversations require IDs unique across requests; chunk matching
            // below continues to use the original upstream ID.
            const toolCallIdPrefix = `dsh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            const normalizeToolCallId = (id) => id ? `${toolCallIdPrefix}_${id}` : "";
'@.TrimEnd("`r", "`n")
    ),
    @('                        id: toolCall.id || "",', '                        id: normalizeToolCallId(toolCall.id),'),
    @('                                block.id = toolCall.id;', '                                block.id = normalizeToolCallId(toolCall.id);'),
    @('                                    pendingReasoningDetailsByToolCallId.set(detail.id, serializedDetail);', '                                    pendingReasoningDetailsByToolCallId.set(normalizeToolCallId(detail.id), serializedDetail);')
)

foreach ($replacement in $replacements) {
    $old = $replacement[0]
    $new = $replacement[1]
    $count = ([regex]::Matches($content, [regex]::Escape($old))).Count
    if ($count -ne 1) {
        throw "Expected one patch location, found ${count}: $old"
    }
    $content = $content.Replace($old, $new)
}

Copy-Item -LiteralPath $adapterPath -Destination $backupPath -Force
Set-Content -LiteralPath $adapterPath -Value $content -NoNewline
node --check $adapterPath

Write-Host 'Patch applied successfully.'
Write-Host "Backup: $backupPath"
