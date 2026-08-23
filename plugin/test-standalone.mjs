// Standalone test harness for dsh-ollama-call-id-auto (portable).
//
// Usage:
//   node test-standalone.mjs <path-to-pristine-openai-completions.js>
//
// The pristine file is an UNPATCHED `dist/api/openai-completions.js` from the
// exact pi-ai version installed in DSH (download it via `npm pack
// @earendil-works/pi-ai@<version>`). The live (installed) adapter is
// auto-discovered with the module's own findAdapterFiles(), so no machine
// paths are hard-coded.
//
// Imports the REAL module constants (PATCHED_MARKER, REPLACEMENTS) — zero
// divergence between test and production.
//
// Checks:
//   1. ANCHORS  — each `old` anchor appears exactly once in the pristine file.
//   2. FORWARD  — patching the pristine file reproduces the live adapter
//                 byte-for-byte (modulo the generated per-response prefix line).
//   3. SYNTAX   — patched output passes `node --check` (as ESM).
//   4. IDEMPOTENT — the real apply() is a no-op on the live (patched) adapter.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, "lib", "index.js")).href);
const { PATCHED_MARKER, REPLACEMENTS, adapterCandidatesForLauncher, apply, findAdapterFiles, patchFile } = mod;

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const count = (haystack, needle) => haystack.split(needle).length - 1;
let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  ok   " : "  FAIL ") + msg);
  if (!cond) failures += 1;
};

// ---- verify hoisted dependency discovery ----
const syntheticRoot = join(here, "fixture", "node_modules");
const syntheticLauncher = join(syntheticRoot, "@deepseek-ai", "dsh");
const expectedHoistedAdapter = join(syntheticRoot, "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js");
ok(
  adapterCandidatesForLauncher(syntheticLauncher).includes(expectedHoistedAdapter),
  "discovers pi-ai hoisted beside the @deepseek-ai scope"
);

// ---- discover the live adapter ----
const liveFiles = findAdapterFiles();
if (liveFiles.length === 0) {
  console.error("No pi-ai adapter discovered under this DSH install; cannot test.");
  process.exit(2);
}
const LIVE = liveFiles[0];
const live = readFileSync(LIVE, "utf8");
console.log("live adapter: " + LIVE);
ok(live.includes(PATCHED_MARKER), "live file is patched (precondition)");

const pristineArg = process.argv[2];
if (!pristineArg) {
  console.log("\n(no pristine file arg — running discovery + idempotency only)");
  const hashBefore = sha(live);
  apply();
  const liveAfter = readFileSync(LIVE, "utf8");
  ok(sha(liveAfter) === hashBefore, "live file unchanged after apply() (idempotent)");
  console.log("\n" + (failures === 0 ? "PASSED (partial)" : `${failures} FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

const PRISTINE = pristineArg;
const pristine = readFileSync(PRISTINE, "utf8");
ok(!pristine.includes(PATCHED_MARKER), "pristine file is unpatched (precondition)");

// ---- 1. ANCHORS ----
console.log("\n[1. anchors in pristine file]");
for (const { old: anchor } of REPLACEMENTS) {
  const n = count(pristine, anchor);
  ok(n === 1, `anchor x${n} (expect 1): ${anchor.trimEnd().slice(0, 58)}…`);
}

// ---- 2. FORWARD ----
console.log("\n[2. forward patch]");
let work = pristine;
for (const { old: anchor, new: replacement } of REPLACEMENTS) {
  work = work.split(anchor).join(replacement);
}
ok(work.includes(PATCHED_MARKER), "forward patch produced the expected marker");
const stripPrefix = (t) =>
  t.split("\n").filter((l) => !l.startsWith("            const toolCallIdPrefix = `")).join("\n");
ok(
  stripPrefix(work) === stripPrefix(live),
  "patched pristine file is byte-identical to the live adapter (modulo generated prefix)"
);

// ---- 3. SYNTAX ----
console.log("\n[3. syntax check]");
const tmp = join(tmpdir(), "dsh-oci-" + Date.now() + ".mjs");
writeFileSync(tmp, work, "utf8");
let syntaxOk = true;
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
} catch (e) {
  syntaxOk = false;
  console.log("  node --check stderr: " + ((e.stderr || "").toString().split("\n").slice(0, 6).join("\n")));
}
ok(syntaxOk, "patched output passes `node --check` (ESM)");

// ---- 4. IDEMPOTENT ----
console.log("\n[4. real apply() against live install]");
const hashBefore = sha(live);
apply();
const liveAfter = readFileSync(LIVE, "utf8");
ok(sha(liveAfter) === hashBefore, "live file unchanged after apply() (idempotent)");

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
