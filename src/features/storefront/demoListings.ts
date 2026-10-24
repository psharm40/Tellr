// fictional listings for the demo. photos come from the shopper's own uploads, never scraped assets.
import type { CheckoutSnapshot, Listing } from "@/types/tellr";

export const DEMO_LISTINGS: Listing[] = [
  {
    id: "listing_demo_laptop_001",
    title: "Used 13-inch laptop, silver",
    description:
      "Lightly used 13-inch laptop. Charger included. Screen has no cracks. Small scuff on the lid corner. Battery holds a charge.",
    category: "laptop",
    itemPriceCents: 25000,
    currency: "USD",
    images: [],
  },
  {
    id: "listing_demo_laptop_002",
    title: "Used 14-inch laptop, black",
    description: "14-inch laptop, about two years old. Works well. Some wear on the keyboard.",
    category: "laptop",
    itemPriceCents: 28000,
    currency: "USD",
    images: [],
  },
];

// fictional checkout terms shown when a listing is chosen. the shopper can edit every field.
const CHECKOUT_TERMS: Record<string, Pick<CheckoutSnapshot, "shippingCents" | "taxCents" | "estimatedDeliveryDate">> = {
  listing_demo_laptop_001: { shippingCents: 1500, taxCents: 2063, estimatedDeliveryDate: "2026-10-30" },
  listing_demo_laptop_002: { shippingCents: 1200, taxCents: 2310, estimatedDeliveryDate: "2026-11-02" },
};

export function initialCheckout(listing: Listing, version: number): CheckoutSnapshot {
  const terms = CHECKOUT_TERMS[listing.id] ?? { shippingCents: null, taxCents: null, estimatedDeliveryDate: null };
  return {
    id: `checkout_${listing.id}`,
    version,
    listingId: listing.id,
    currency: "USD",
    quantity: 1,
    unitPriceCents: listing.itemPriceCents,
    ...terms,
    addOns: [],
    hasSubscription: false,
  };
}
