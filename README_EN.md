# DSH + vLLM Tool-Call ID Fix

[中文](README.md)

<p align="center">
  <img src="assets/history-load-error.png" alt="History load failure caused by duplicate tool-call ID" width="1088">
</p>

> Fixes DeepSeek Harness conversation-history loading when a vLLM OpenAI-compatible endpoint reuses a tool-call ID such as `call_0` across requests.

## Problem

Some vLLM OpenAI-compatible tool-call responses reuse `call_0` on every request. DSH persists that ID unchanged, so reloading a conversation with multiple tool calls can fail with:

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

This is a compatibility issue in vLLM's tool-call parsing and OpenAI API adaptation layer, not the model itself generating duplicate OpenAI tool-call IDs. The model generates tool-call text (function names, arguments, and markers); vLLM parses it and then assembles `tool_call.id`. Its per-request numbering starts at `call_0` and resets for the next request, so the ID repeats across turns. DSH persists that ID unchanged, which causes the collision in conversation history.

## Fix

The script patches the locally installed `@earendil-works/pi-ai` OpenAI Completions adapter. It namespaces each response's tool-call IDs, for example:

```text
dsh_mswogrud_pz76l04y_call_0
```

The original ID is still used to correlate chunks within one streamed response, while persisted calls and tool results receive globally unique IDs.

## Usage

1. Stop DeepSeek Harness.
2. Run in PowerShell:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\patch-dsh-vllm-tool-call-ids.ps1
   ```

3. Restart DeepSeek Harness and test multiple consecutive tool calls in a new conversation.

The script first creates an `openai-completions.js.dsh-call-id.bak` backup. Existing broken histories are left untouched.

## Notes

- Tested against `@deepseek-ai/dsh 0.1.0-rc.6`.
- Reinstalling or upgrading DSH may overwrite the patch; rerun the script afterward if needed.
- This is a client-side compatibility workaround until upstream vLLM emits tool-call IDs that are globally unique across requests; the ideal upstream fix is for vLLM to generate those IDs.
