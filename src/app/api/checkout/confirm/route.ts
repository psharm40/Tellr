// post /api/checkout/confirm: re-checks the checkout and returns a demo order only.
// this route never places a real order or handles payment details.
import { confirmDemoOrder } from "@/features/checkout/confirmDemoOrder";
import { validateConfirmRequest } from "@/features/checkout/validate";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid json" }, { status: 400 });
  }
  const parsed = validateConfirmRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const result = confirmDemoOrder(parsed.value);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.httpStatus });
  return Response.json({ demoOrderId: result.demoOrderId, status: result.status });
}
