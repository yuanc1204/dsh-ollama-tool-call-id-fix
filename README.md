# DSH + vLLM Tool-Call ID Fix

[中文](#中文) · [English](#english)

<p align="center">
  <img src="assets/history-load-error.png" alt="History load failure caused by duplicate tool-call ID" width="1088">
</p>

> Fixes DSH conversation-history loading when a vLLM OpenAI-compatible endpoint reuses a tool-call ID such as `call_0` across requests.

---

## 中文

### 问题

部分 vLLM OpenAI-compatible 工具调用响应会在每个请求中重新使用 `call_0`。DSH 原样保存该 ID；当一轮对话包含多次工具调用时，历史重载会失败：

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

### 修复方式

脚本会修补本机安装的 `@earendil-works/pi-ai` OpenAI Completions 适配器，为每个响应生成唯一前缀，例如：

```text
dsh_mswogrud_pz76l04y_call_0
```

原始 ID 仍用于同一响应流的分块匹配；写入会话历史和工具结果的 ID 则保持全局唯一。

### 使用

1. 关闭 DeepSeek Harness。
2. 在 PowerShell 中运行：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\patch-dsh-vllm-tool-call-ids.ps1
   ```

3. 重启 DeepSeek Harness，并新建对话测试连续工具调用。

脚本会先生成 `openai-completions.js.dsh-call-id.bak` 备份。旧的损坏历史不会被修改。

---

## English

### Problem

Some vLLM OpenAI-compatible tool-call responses reuse `call_0` on every request. DSH persists that ID unchanged, so reloading a conversation with multiple tool calls can fail with:

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

### Fix

The script patches the locally installed `@earendil-works/pi-ai` OpenAI Completions adapter. It namespaces each response's tool-call IDs, for example:

```text
dsh_mswogrud_pz76l04y_call_0
```

The original ID is still used to correlate chunks within one streamed response, while persisted calls and tool results receive globally unique IDs.

### Usage

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
- Reinstalling or upgrading DSH may overwrite the patched dependency; rerun the script afterward if needed.
- This is a client-side compatibility workaround until the upstream server emits globally unique tool-call IDs.
