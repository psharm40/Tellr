// LIVE test harness — makes REAL anthropic api calls. run ONLY with explicit
// approval. ambient anthropic auth is stripped so the Tellr key from .env.local is
// used (not claude code's subscription auth):
//   env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_PROFILE \
//     node --env-file=.env.local --disable-warning=ExperimentalWarning \
//     src/features/inspection/__tests__/live.mjs
//
// it never reads, logs, or exposes the api key. a HARD CAP of 3 total real api
// attempts is enforced here (including sdk + app-level retries): sdk retries are
// forced off per request (maxRetries: 0) and a global counter refuses a 4th call.
import { registerHooks } from "node:module";

const SRC = new URL("../../../", import.meta.url);
// NOTE: unlike run.mjs/scenarios.mjs this does NOT mock @anthropic-ai/sdk — real sdk.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", SRC).href, context);
    const parent = context.parentURL || "";
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent.includes("/src/")) {
      const last = specifier.split("/").pop();
      if (last && !last.includes(".")) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const imp = (p) => import(new URL(p + ".ts", SRC).href);
const { inspectListing } = await imp("features/inspection/inspectListing");
const { assignRequirementIds } = await imp("features/inspection/requirementIds");
const { getAnthropicClient } = await imp("features/inspection/anthropicClient");
const { getModel } = await imp("features/inspection/model");
const { buildCases } = await import(new URL("./live-fixtures.mjs", import.meta.url).href);

// confirm (model name is not a secret). the key itself is never read or printed.
console.log("model:", getModel());
console.log("ANTHROPIC_API_KEY present:", Boolean(process.env.ANTHROPIC_API_KEY));
console.log("");

// --- HARD CAP: at most 3 real api attempts total, incl. sdk + app retries --------
const CAP = 3;
let attempts = 0;
const client = getAnthropicClient(); // real client, cached singleton (needs the key)
const origCreate = client.messages.create.bind(client.messages);
client.messages.create = (params, options = {}) => {
  if (attempts >= CAP) {
    return Promise.reject(new Error(`live hard cap reached: refusing api attempt #${attempts + 1} (max ${CAP})`));
  }
  attempts++;
  console.log(`[real api attempt ${attempts}/${CAP}]`);
  // maxRetries:0 => exactly one http attempt per create (no sdk-internal retries).
  return origCreate(params, { ...options, maxRetries: 0 });
};
// inspectListing calls getAnthropicClient() internally -> same patched singleton.

const cases = buildCases(assignRequirementIds);
for (const c of cases) {
  console.log("====================================================");
  console.log(c.name, `(api attempts used so far: ${attempts}/${CAP})`);
  try {
    const report = await inspectListing(c.listing, c.preferences);
    console.log("REPORT:");
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.log("ERROR:", e && e.code ? `${e.code}: ${e.message}` : e && e.message);
  }
  console.log("");
}
console.log(`TOTAL real api attempts: ${attempts}/${CAP}`);
