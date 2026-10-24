// zero-dependency test runner for src/features/checkout and src/app/api/checkout.
// transpiles that typescript with the repo's own typescript package, then runs node:test.
// usage: node src/features/checkout/scripts/run-tests.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const checkoutDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(checkoutDir, "..", "..");
const roots = [checkoutDir, join(srcDir, "app", "api", "checkout")];
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
  for (const file of roots.flatMap((root) => sources(root))) {
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
      reportDiagnostics: true,
    });
    if (diagnostics?.length) {
      console.error(ts.formatDiagnostics(diagnostics, ts.createCompilerHost({})));
      process.exit(1);
    }
    const target = join(outDir, relative(srcDir, file)).replace(/\.ts$/, ".js");
    // map the "@/" path alias onto the transpiled tree; only checkout code is available at runtime
    const code = outputText.replace(/require\("@\/([^"]+)"\)/g, (_, path) => {
      let rel = relative(dirname(target), join(outDir, path));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `require(${JSON.stringify(rel)})`;
    });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, code);
    if (target.endsWith(".test.js")) tests.push(target);
  }
  writeFileSync(join(outDir, "package.json"), '{ "type": "commonjs" }\n');
  const run = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
