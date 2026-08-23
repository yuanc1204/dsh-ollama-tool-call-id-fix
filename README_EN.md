# DSH + Ollama Tool-Call ID Fix

[中文](README.md)

<p align="center">
  <img src="assets/history-load-error.png" alt="History load failure caused by duplicate tool-call ID" width="1088">
</p>

> Fixes DeepSeek Harness conversation-history loading when an Ollama OpenAI-compatible endpoint reuses a tool-call ID such as `call_0` across requests.
>
> **Recommended: a DSH plugin that re-applies the patch automatically** — on every DSH boot it detects and re-patches, so no manual step is needed after a DSH upgrade. See [Option 1](#option-1-recommendeddsh-auto-patch-plugin).

## Problem

Some Ollama OpenAI-compatible tool-call responses reuse `call_0` on every request. DSH persists that ID unchanged, so reloading a conversation with multiple tool calls can fail with:

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

This is a compatibility issue in Ollama's tool-call parsing and OpenAI API adaptation layer, not the model itself generating duplicate OpenAI tool-call IDs. The model generates tool-call text (function names, arguments, and markers); Ollama parses it and then assembles `tool_call.id`. On the affected API path or version, that ID repeats as `call_0` across requests. DSH persists it unchanged, which causes the collision in conversation history.

## How the fix works

The patch is applied to the locally installed `@earendil-works/pi-ai` OpenAI Completions adapter (`dist/api/openai-completions.js`). It namespaces each response's tool-call IDs with a per-response prefix, for example:

```text
dsh_mswogrud_pz76l04y_call_0
```

The original ID is still used to correlate chunks within one streamed response. At the start of each response, a fresh timestamp-and-random prefix is generated for persisted calls and tool results, keeping their IDs unique across requests in normal use.

## Option 1 (recommended): DSH auto-patch plugin

The `plugin/` directory is a standard DSH bundle plugin (`dsh-ollama-call-id-auto`). It runs **at DSH boot**:

- locates the pi-ai adapter inside the DSH install tree;
- if unpatched → validates the anchors are unique, then patches (writing a `.bak` backup first);
- if already patched → skips (idempotent);
- if the pi-ai build changed and the anchors don't match → skips and logs, **never breaking DSH boot**.

Because pi-ai's `openai-completions.js` is **lazy-imported on the first request**, rewriting the on-disk file at boot takes effect for the current process immediately — no second restart needed.

### Install

```powershell
# 1) Get this repo
git clone https://github.com/yuanc1204/dsh-ollama-tool-call-id-fix
cd dsh-ollama-tool-call-id-fix

# 2) One-click install (copy into custom-plugins and register in the web profile)
.\setup.ps1

# 3) Restart DeepSeek Harness and test consecutive tool calls in a new conversation
```

Or do it manually in two steps:

```powershell
Copy-Item .\plugin $env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto -Recurse -Force
dsh plugin --profile web add link:$env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto
```

After a successful install, every DSH boot logs (to stderr):

```text
[dsh-ollama-call-id-auto] patched: …\openai-completions.js      # first time / after an upgrade
[dsh-ollama-call-id-auto] already patched, skipping: …          # on every subsequent boot
```

### Uninstall

```powershell
dsh plugin --profile web remove dsh-ollama-call-id-auto
Remove-Item $env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto -Recurse -Force
```

## Option 2: one-shot manual patch (script)

If you'd rather not install a plugin, run the script directly. **Note: you must re-run it after every DSH upgrade/reinstall.**

1. Stop DeepSeek Harness.
2. Run in PowerShell:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\patch-dsh-ollama-tool-call-ids.ps1
   ```

3. Restart DeepSeek Harness and test multiple consecutive tool calls in a new conversation.

The script first creates an `openai-completions.js.dsh-call-id.bak` backup. Existing broken histories are left untouched.

## Verification

A portable test ships in the repo (`plugin/test-standalone.mjs`):

```powershell
# Prepare a pristine (unpatched) pi-ai matching the version DSH uses (e.g. 0.82.1)
$pi = npm view @earendil-works/pi-ai version   # confirm the version
# `npm pack` it, extract dist/api/openai-completions.js as the pristine reference
node plugin\test-standalone.mjs <path-to-pristine-openai-completions.js>
```

It verifies that the 4 anchors each appear exactly once in the pristine file, that the patched result is byte-identical to the live adapter (modulo the generated prefix), that it passes `node --check`, and that it is idempotent on an already-patched file.

## Notes

- Verified against `@deepseek-ai/dsh 0.1.0-rc.6 / 0.1.1-rc.2` and `@earendil-works/pi-ai 0.82.1`: the patched output is byte-identical to the official build and passes `node --check`.
- Reinstalling or upgrading DSH overwrites the patched `openai-completions.js`: **Option 1** re-patches automatically on the next boot; **Option 2** requires re-running the script manually.
- Existing broken histories are left untouched.
- This is a client-side compatibility workaround until upstream Ollama emits tool-call IDs that are globally unique across requests on the affected API path or version; the ideal upstream fix is for Ollama to generate those IDs.
