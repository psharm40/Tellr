// zero-dependency test runner for src/features/checkout.
// transpiles the checkout typescript with the repo's own typescript package, then runs node:test.
// usage: node src/features/checkout/scripts/run-tests.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const checkoutDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "tellr-checkout-tests-"));

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "scripts" ? [] : sources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

try {
  const tests = [];
  for (const file of sources(checkoutDir)) {
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
      reportDiagnostics: true,
    });
    if (diagnostics?.length) {
      console.error(ts.formatDiagnostics(diagnostics, ts.createCompilerHost({})));
      process.exit(1);
    }
    // only type imports may cross the checkout folder; a runtime "@/..." import would fail here
    if (/require\("@\//.test(outputText)) {
      console.error(`${relative(checkoutDir, file)} has a runtime "@/" import; use "import type" or a relative path`);
      process.exit(1);
    }
    const target = join(outDir, relative(checkoutDir, file)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputText);
    if (target.endsWith(".test.js")) tests.push(target);
  }
  writeFileSync(join(outDir, "package.json"), '{ "type": "commonjs" }\n');
  const run = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
