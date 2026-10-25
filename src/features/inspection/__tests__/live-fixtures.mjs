// shared fixtures for the live photo test and its no-network preflight, so both
// validate/send the exact same inputs. pure: reads the local photo files and builds
// Listing + ShoppingPreferences objects. no network, no api key required. the id
// assigner is injected so this module has no .ts imports of its own.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PHOTO_DIR = join(homedir(), "Desktop", "Tellr-Test-Photos");
const dataUrl = (file) =>
  "data:image/jpeg;base64," + readFileSync(join(PHOTO_DIR, file)).toString("base64");

const screen = { attribute: "screen_condition", operator: "equals", value: "no_cracks", priority: "required" };
const charger = { attribute: "charger_included", operator: "equals", value: true, priority: "required" };
const scratches = { attribute: "cosmetic_scratches", operator: "allowed", value: true, priority: "preference" };
const noSub = { attribute: "no_subscription", operator: "equals", value: true, priority: "required" };

// builds the three test cases. assignRequirementIds is injected (the real impl).
export function buildCases(assignRequirementIds) {
  return [
    {
      name: "1. cracked screen",
      listing: {
        id: "test-cracked", title: "Dell laptop", description: "Dell laptop, works perfectly, no issues.",
        category: "laptop", itemPriceCents: 40000, currency: "USD",
        images: [{ id: "photo-cracked", url: dataUrl("laptop_cracked.jpeg"), alt: "seller photo; condition unverified" }],
      },
      preferences: { category: "laptop", maxTotalCents: 50000, requirements: assignRequirementIds([screen, charger]) },
    },
    {
      name: "2. fixed / clean",
      listing: {
        id: "test-fixed", title: "Used laptop", description: "Used laptop, good condition, charger included.",
        category: "laptop", itemPriceCents: 40000, currency: "USD",
        images: [{ id: "photo-fixed", url: dataUrl("laptop_fixed.jpeg"), alt: "seller photo; condition unverified" }],
      },
      preferences: { category: "laptop", maxTotalCents: 50000, requirements: assignRequirementIds([screen, charger, scratches]) },
    },
    {
      name: "3. dell / multi-requirement",
      listing: {
        id: "test-dell", title: "Dell laptop", description: "Dell laptop. Charger included. No subscription.",
        category: "laptop", itemPriceCents: 35000, currency: "USD",
        images: [{ id: "photo-dell", url: dataUrl("laptop_dell.jpeg"), alt: "seller photo; condition unverified" }],
      },
      preferences: { category: "laptop", maxTotalCents: 50000, requirements: assignRequirementIds([screen, charger, noSub]) },
    },
  ];
}
