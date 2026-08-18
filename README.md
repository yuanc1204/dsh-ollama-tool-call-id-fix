# DSH + Ollama 工具调用 ID 修复

[English](README_EN.md)

<p align="center">
  <img src="assets/history-load-error.png" alt="工具调用 ID 重复导致的历史加载失败" width="1088">
</p>

> 修复 Ollama OpenAI-compatible 接口跨请求重复使用工具调用 ID（如 `call_0`）时，DeepSeek Harness 无法加载对话历史的问题。

## 问题

部分 Ollama OpenAI-compatible 工具调用响应会在每个请求中重新使用 `call_0`。DSH 原样保存该 ID；当对话包含多次工具调用时，历史重载会失败：

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

这是 Ollama 的工具调用解析和 OpenAI 接口适配层造成的兼容性问题，而不是模型本身生成了重复的 OpenAI 工具调用 ID：模型生成的是工具调用文本（函数名、参数和标记），Ollama 解析后再组装 `tool_call.id`。在受影响的接口路径或版本中，该 ID 会在请求间重复为 `call_0`；DSH 将它原样持久化，才导致历史中的同名 ID 冲突。

## 修复方式

脚本会修补本机安装的 `@earendil-works/pi-ai` OpenAI Completions 适配器，为每个响应生成唯一前缀，例如：

```text
dsh_mswogrud_pz76l04y_call_0
```

原始 ID 仍用于同一响应流的分块匹配；写入会话历史和工具结果的 ID 则保持全局唯一。

## 使用

1. 关闭 DeepSeek Harness。
2. 在 PowerShell 中运行：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\patch-dsh-ollama-tool-call-ids.ps1
   ```

3. 重启 DeepSeek Harness，并新建对话测试连续工具调用。

脚本会先生成 `openai-completions.js.dsh-call-id.bak` 备份。旧的损坏历史不会被修改。

## 说明

- 已针对 `@deepseek-ai/dsh 0.1.0-rc.6` 验证。
- 重装或升级 DSH 可能覆盖补丁；届时重新运行脚本即可。
- 这是上游 Ollama 服务在受影响接口路径或版本中尚未生成跨请求全局唯一工具调用 ID 时的客户端兼容性修复；理想的上游修复应由 Ollama 输出全局唯一 ID。
