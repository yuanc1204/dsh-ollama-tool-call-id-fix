# DSH + Ollama 工具调用 ID 修复

[English](README_EN.md)

<p align="center">
  <img src="assets/history-load-error.png" alt="工具调用 ID 重复导致的历史加载失败" width="1088">
</p>

> 修复 Ollama OpenAI-compatible 接口跨请求重复使用工具调用 ID（如 `call_0`）时，DeepSeek Harness 无法加载对话历史的问题。
>
> **推荐用 DSH 插件实现自动打补丁**：DSH 每次启动时自动检测并重打，升级 DSH 后无需手动操作。见[方案一](#方案一推荐dsh-自动补丁插件)。

## 问题

部分 Ollama OpenAI-compatible 工具调用响应会在每个请求中重新使用 `call_0`。DSH 原样保存该 ID；当对话包含多次工具调用时，历史重载会失败：

```text
conversation Context … tool-callcall_0 received more than one start Match (internal)
```

这是 Ollama 的工具调用解析和 OpenAI 接口适配层造成的兼容性问题，而不是模型本身生成了重复的 OpenAI 工具调用 ID：模型生成的是工具调用文本（函数名、参数和标记），Ollama 解析后再组装 `tool_call.id`。在受影响的接口路径或版本中，该 ID 会在请求间重复为 `call_0`；DSH 将它原样持久化，才导致历史中的同名 ID 冲突。

## 修复原理

补丁作用于本机安装的 `@earendil-works/pi-ai`（OpenAI Completions 适配器，`dist/api/openai-completions.js`）：为每个响应生成唯一前缀，例如：

```text
dsh_mswogrud_pz76l04y_call_0
```

原始 ID 仍用于同一响应流的分块匹配；写入会话历史和工具结果的 ID 则在每个响应开始处理时加上新生成的时间戳与随机前缀，从而在正常使用中保持跨请求唯一。

## 方案一（推荐）：DSH 自动补丁插件

`plugin/` 目录是一个标准的 DSH bundle 插件（`dsh-ollama-call-id-auto`）。它在 **DSH 启动时**运行：

- 定位本机 DSH 安装树里的 pi-ai 适配器；
- 若尚未打补丁 → 校验锚点唯一后打补丁（先写 `.bak` 备份）；
- 若已打补丁 → 跳过（幂等）；
- 若 pi-ai 版本变化导致锚点不匹配 → 跳过并打日志，**绝不影响 DSH 启动**。

因为 pi-ai 的 `openai-completions.js` 是**首次请求时才惰性加载**的，启动时改写磁盘文件即可对当前进程立即生效，无需二次重启。

### 安装

```powershell
# 1) 获取本仓库
git clone https://github.com/yuanc1204/dsh-ollama-tool-call-id-fix
cd dsh-ollama-tool-call-id-fix

# 2) 一键安装（复制到自定义插件目录并注册到 web profile）
.\setup.ps1

# 3) 重启 DeepSeek Harness，新建对话测试连续工具调用
```

或手动两步：

```powershell
Copy-Item .\plugin $env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto -Recurse -Force
dsh plugin --profile web add link:$env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto
```

安装成功后，每次启动 DSH 都会在日志（stderr）看到：

```text
[dsh-ollama-call-id-auto] patched: …\openai-completions.js      # 首次 / 升级后
[dsh-ollama-call-id-auto] already patched, skipping: …          # 之后每次
```

### 卸载

```powershell
dsh plugin --profile web remove dsh-ollama-call-id-auto
Remove-Item $env:USERPROFILE\.dsh\custom-plugins\dsh-ollama-call-id-auto -Recurse -Force
```

## 方案二：一次性手动补丁（脚本）

不想装插件时，可直接运行脚本。**注意：每次 DSH 升级/重装后需要手动重跑。**

1. 关闭 DeepSeek Harness。
2. 在 PowerShell 中运行：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\patch-dsh-ollama-tool-call-ids.ps1
   ```

3. 重启 DeepSeek Harness，并新建对话测试连续工具调用。

脚本会先生成 `openai-completions.js.dsh-call-id.bak` 备份。旧的损坏历史不会被修改。

## 验证

本仓库附带可移植测试（`plugin/test-standalone.mjs`）：

```powershell
# 准备一份与 DSH 相同版本的未打补丁 pi-ai（例如 0.82.1）
$pi = npm view @earendil-works/pi-ai version   # 确认版本
# 用 npm pack 下载后解出 dist/api/openai-completions.js 作为 pristine 参考
node plugin\test-standalone.mjs <pristine-openai-completions.js 路径>
```

它会核对：4 个锚点在 pristine 文件中各出现一次、打补丁后与线上文件逐字节一致（除现场生成的前缀外）、`node --check` 通过、对已打补丁文件幂等。

## 说明

- 已针对 `@deepseek-ai/dsh 0.1.0-rc.6 / 0.1.1-rc.2`、`@earendil-works/pi-ai 0.82.1` 验证：补丁产物与官方构建逐字节一致，且通过 `node --check`。
- 重装或升级 DSH 会覆盖被修补的 `openai-completions.js`：**方案一**在下次启动自动重打；**方案二**需手动重跑脚本。
- 旧的损坏历史不会被修改。
- 这是上游 Ollama 服务在受影响接口路径或版本中尚未生成跨请求全局唯一工具调用 ID 时的客户端兼容性修复；理想的上游修复应由 Ollama 输出全局唯一 ID。
