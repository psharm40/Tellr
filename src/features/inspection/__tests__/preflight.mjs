// NO-NETWORK preflight for the live photo test. builds the exact same inputs the
// live harness will send and validates them against the frozen contracts and the
// image rules. makes ZERO api calls and needs no api key. run:
//   node --disable-warning=ExperimentalWarning src/features/inspection/__tests__/preflight.mjs
import { registerHooks } from "node:module";

const SRC = new URL("../../../", import.meta.url);
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
const { assignRequirementIds } = await imp("features/inspection/requirementIds");
const { inspectionRequestSchema, listingSchema } = await imp("features/inspection/inspectionSchemas");
const { shoppingPreferencesSchema } = await imp("features/inspection/schemas");
const { validateListingImages } = await imp("features/inspection/imageValidation");
const { buildCases } = await import(new URL("./live-fixtures.mjs", import.meta.url).href);

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}${d ? "  — " + d : ""}`); } };

const cases = buildCases(assignRequirementIds);
check("builds exactly 3 cases (=> max 3 api calls)", cases.length === 3, `got ${cases.length}`);

for (const c of cases) {
  // request conforms to the frozen Listing + ShoppingPreferences contracts.
  check(`${c.name}: inspectionRequest conforms to contract`,
    inspectionRequestSchema.safeParse({ listing: c.listing, preferences: c.preferences }).success);
  check(`${c.name}: listing conforms to Listing contract`, listingSchema.safeParse(c.listing).success);
  check(`${c.name}: preferences conform to ShoppingPreferences contract`, shoppingPreferencesSchema.safeParse(c.preferences).success);
  // images decode and pass the data-url / size rules.
  const img = validateListingImages(c.listing.images);
  check(`${c.name}: images valid (data url, size, count)`, img.ok === true, img.ok ? "" : img.message);
  if (img.ok) {
    check(`${c.name}: image is base64 jpeg with non-empty payload`,
      img.images.every((i) => i.mediaType === "image/jpeg" && i.data.length > 0));
  }
  // requirement ids are present and unique (so report requirementId refs resolve).
  const ids = c.preferences.requirements.map((r) => r.id);
  check(`${c.name}: requirement ids present & unique`, ids.length > 0 && new Set(ids).size === ids.length);
}

console.log("\n----------------------------------------");
console.log(`PREFLIGHT: ${pass} passed, ${fail} failed  (0 network calls)`);
if (fail > 0) process.exitCode = 1;
