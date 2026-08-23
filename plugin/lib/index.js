/**
 * dsh-ollama-call-id-auto — boot-time auto-patcher for the pi-ai
 * OpenAI-completions adapter.
 *
 * Why
 * ---
 * Ollama (and some other OpenAI-compatible endpoints) reuse a tool-call ID
 * such as `call_0` across requests. DSH persists that ID unchanged, so
 * reloading a conversation that contains more than one tool call fails with:
 *
 *   conversation Context … tool-callcall_0 received more than one start Match
 *
 * This plugin re-applies a small, idempotent patch to the pi-ai adapter on
 * every DSH boot. The patch namespaces each response's tool-call IDs with a
 * per-response prefix (e.g. `dsh_<ts36>_<rand>_call_0`). The original upstream
 * ID is still used to correlate chunks within one streamed response; only
 * the ID that gets persisted is namespaced, so history reload works.
 *
 * Timing
 * -----
 * The pi-ai `openai-completions.js` module is lazy-imported on the first
 * stream call (see `@earendil-works/pi-ai` `dist/api/openai-completions.lazy.js`
 * and `dist/api/lazy.js`). It is NOT in memory at boot. So patching the
 * on-disk file during the plugin's boot-time `apply()` is guaranteed to be
 * in place before any LLM request, and takes effect immediately without a
 * second restart.
 *
 * Safety
 * -----
 * - Idempotent: if the adapter is already patched (marker present), it is
 *   left alone.
 * - Non-fatal: every error is logged to stderr and swallowed. The patcher
 *   must never break DSH boot.
 * - Version-tolerant: if the pi-ai build has a different shape (any anchor
 *   string missing or duplicated), the file is skipped with a log line
 *   rather than half-patched.
 * - Cross-platform: pure Node, no shell, no external deps.
 *
 * Discovery
 * ---------
 * The pi-ai adapter lives inside the `@deepseek-ai/dsh` install tree (a
 * transitive dep of `@deepseek-ai/dsh-llm-pi-ai`). We locate the dsh
 * launcher package by walking up from the resolved process entrypoint
 * (argv[1]), which covers global npm, npx-cache, and local/monorepo
 * installs; platform-specific npm global roots are checked as a fallback.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export const name = "dsh-ollama-call-id-auto";
const VERSION = "0.1.0";

// Marker that identifies an already-patched adapter (the prefix declaration).
// Kept as a plain string; the backticks / ${...} are literal characters here.
export const PATCHED_MARKER =
  "const toolCallIdPrefix = `dsh_${Date.now().toString(36)}_";

// The (old, new) substitutions, applied in order. Each `old` must appear
// exactly once in an unpatched adapter. Indentation is load-bearing and must
// match the compiled pi-ai output exactly. Exported for testability.
export const REPLACEMENTS = [
  {
    old: "            const pendingReasoningDetailsByToolCallId = new Map();",
    new: [
      "            const pendingReasoningDetailsByToolCallId = new Map();",
      "            // Ollama may repeat IDs such as \"call_0\" across requests. Persisted",
      "            // conversations require IDs unique across requests; chunk matching",
      "            // below continues to use the original upstream ID.",
      "            const toolCallIdPrefix = `dsh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;",
      "            const normalizeToolCallId = (id) => id ? `${toolCallIdPrefix}_${id}` : \"\";",
    ].join("\n"),
  },
  {
    old: "                        id: toolCall.id || \"\",",
    new: "                        id: normalizeToolCallId(toolCall.id),",
  },
  {
    old: "                                block.id = toolCall.id;",
    new: "                                block.id = normalizeToolCallId(toolCall.id);",
  },
  {
    old: "                                    pendingReasoningDetailsByToolCallId.set(detail.id, serializedDetail);",
    new: "                                    pendingReasoningDetailsByToolCallId.set(normalizeToolCallId(detail.id), serializedDetail);",
  },
];

function log(...args) {
  try {
    process.stderr.write(`[dsh-ollama-call-id-auto] ` + args.join(" ") + "\n");
  } catch {
    /* never let logging break boot */
  }
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function isDshLauncher(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg.name === "@deepseek-ai/dsh";
  } catch {
    return false;
  }
}

/**
 * Find all `@deepseek-ai/dsh` launcher package directories reachable from
 * the running process. Walking up from the resolved entrypoint covers
 * global npm, npx-cache, and local/monorepo installs.
 */
function findLauncherDirs() {
  const found = new Set();
  let entry = null;
  try {
    const a1 = process.argv[1];
    if (a1) entry = realpathSync(a1);
  } catch {
    entry = null;
  }
  if (entry) {
    let p = dirname(entry);
    let prev = "";
    while (p && p !== prev) {
      prev = p;
      const candidates = [
        join(p, "node_modules", "@deepseek-ai", "dsh"),
        p,
      ];
      for (const cand of candidates) {
        if (isDshLauncher(cand)) {
          found.add(cand);
          break;
        }
      }
      p = dirname(p);
    }
  }
  // Platform fallbacks (global npm / pnpm-global roots).
  const fallbacks = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA)
      fallbacks.push(join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh"));
    if (process.env.LOCALAPPDATA)
      fallbacks.push(join(process.env.LOCALAPPDATA, "npm", "node_modules", "@deepseek-ai", "dsh"));
  } else {
    if (process.env.NPM_CONFIG_PREFIX)
      fallbacks.push(join(process.env.NPM_CONFIG_PREFIX, "lib", "node_modules", "@deepseek-ai", "dsh"));
    if (process.env.HOME)
      fallbacks.push(join(process.env.HOME, ".npm-global", "lib", "node_modules", "@deepseek-ai", "dsh"));
    fallbacks.push("/usr/local/lib/node_modules/@deepseek-ai/dsh");
    fallbacks.push("/usr/lib/node_modules/@deepseek-ai/dsh");
  }
  for (const f of fallbacks) if (isDshLauncher(f)) found.add(f);
  return [...found];
}

/** Return supported pi-ai adapter locations for one DSH launcher package. */
export function adapterCandidatesForLauncher(launcher) {
  return [
    join(launcher, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js"),
    join(launcher, "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js"),
    // npm/pnpm may hoist pi-ai beside the @deepseek-ai scope directory.
    join(dirname(dirname(launcher)), "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js"),
  ];
}

/** For each launcher, yield the pi-ai openai-completions.js paths that exist. */
export function findAdapterFiles() {
  const out = new Set();
  for (const launcher of findLauncherDirs()) {
    for (const candidate of adapterCandidatesForLauncher(launcher)) {
      if (existsSync(candidate)) out.add(candidate);
    }
  }
  return [...out];
}

export function patchFile(adapterPath) {
  const original = readFileSync(adapterPath, "utf8");
  if (original.includes(PATCHED_MARKER)) {
    log(`already patched, skipping: ${adapterPath}`);
    return "skipped";
  }
  // Validate every anchor appears exactly once before touching anything,
  // so we never leave a half-patched file behind.
  for (const { old: anchor } of REPLACEMENTS) {
    const n = countOccurrences(original, anchor);
    if (n !== 1) {
      log(
        `SKIP ${adapterPath}: anchor found ${n}x (expected 1) — pi-ai build shape changed? ` +
          `anchor: ${JSON.stringify(anchor.slice(0, 64))}…`
      );
      return "skipped-version-mismatch";
    }
  }
  // All anchors are unique — apply the substitutions (split/join avoids the
  // `$`-pattern pitfalls of String.replace with a string argument).
  let work = original;
  for (const { old: anchor, new: replacement } of REPLACEMENTS) {
    work = work.split(anchor).join(replacement);
  }
  if (!work.includes(PATCHED_MARKER)) {
    log(`ERROR: substitution did not produce the expected marker in ${adapterPath}; leaving file unchanged.`);
    return "error";
  }
  // Backup the pre-patch state, then write.
  const backupPath = adapterPath + ".dsh-call-id.bak";
  try {
    copyFileSync(adapterPath, backupPath);
  } catch (e) {
    log(`WARN: backup failed (${e && e.message || e}); continuing without backup.`);
  }
  writeFileSync(adapterPath, work, "utf8");
  log(`patched: ${adapterPath}`);
  log(`backup: ${backupPath}`);
  return "patched";
}

/**
 * DSH plugin entry point. Runs at boot, before the first LLM request.
 * Intentionally takes no `ctx` — the patcher only needs the filesystem.
 */
export function apply() {
  let files;
  try {
    files = findAdapterFiles();
  } catch (e) {
    log(`ERROR locating pi-ai adapter: ${(e && e.message) || e}`);
    return;
  }
  if (files.length === 0) {
    log("no pi-ai adapter found under this DSH install; nothing to patch.");
    return;
  }
  let patched = 0, skipped = 0, failed = 0;
  for (const f of files) {
    let result;
    try {
      result = patchFile(f);
    } catch (e) {
      log(`ERROR patching ${f}: ${(e && e.message) || e}`);
      failed += 1;
      continue;
    }
    if (result === "patched") patched += 1;
    else if (result === "skipped" || result === "skipped-version-mismatch") skipped += 1;
    else failed += 1;
  }
  log(`done: ${patched} patched, ${skipped} skipped, ${failed} failed (v${VERSION}).`);
}

// Also expose as a default object for loaders that prefer it.
export default { name, apply, version: VERSION };
