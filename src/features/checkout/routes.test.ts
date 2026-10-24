// calls the real next.js route handlers with web requests. run with: node src/features/checkout/scripts/run-tests.mjs
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { POST as confirmPost } from "../../app/api/checkout/confirm/route";
import { POST as reviewPost } from "../../app/api/checkout/review/route";
import { routeRequestFixtures } from "./fixtures";
import { MISSING_SELECTED_LISTING_ERROR } from "./validate";

function post(route: "review" | "confirm", body: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/checkout/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return route === "review" ? reviewPost(request) : confirmPost(request);
}

describe("checkout routes", () => {
  for (const f of routeRequestFixtures) {
    test(`${f.name} -> ${f.expectedStatus}`, async () => {
      const res = await post(f.route, f.body);
      const data = await res.json();
      assert.equal(res.status, f.expectedStatus, JSON.stringify(data));
      if (f.expectedStatus >= 400) assert.equal(typeof data.error, "string");
      if (f.expectedOverall) assert.equal(data.review.overall, f.expectedOverall);
      if (f.route === "confirm" && f.expectedStatus === 200) {
        assert.equal(data.status, "demo_completed");
        assert.match(data.demoOrderId, /^demo_/);
      }
    });
  }

  test("missing selectedListingId returns the plain-language error on both routes", async () => {
    for (const route of ["review", "confirm"] as const) {
      const f = routeRequestFixtures.find((x) => x.route === route && x.name.endsWith("id missing"));
      assert.ok(f);
      const data = await (await post(route, f.body)).json();
      assert.equal(data.error, MISSING_SELECTED_LISTING_ERROR);
    }
  });

  test("invalid json returns 400", async () => {
    const res = await post("review", "not json");
    assert.equal(res.status, 400);
  });
});
