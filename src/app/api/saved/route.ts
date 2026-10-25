// /api/saved: the shopper's saved list, kept in convex. checks live in
// src/features/saved/savedItems.ts. PROPOSED (needs team / developer 4 review).
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { SavedError, listSaved, removeSaved, saveItem, type SavedStore } from "@/features/saved/savedItems";

function store(): SavedStore {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new SavedError("Saved items aren't connected on this server yet.", 503);
  const client = new ConvexHttpClient(url);
  return {
    list: (ownerId) => client.query(api.savedItems.list, { ownerId }),
    save: (ownerId, item) => client.mutation(api.savedItems.save, { ownerId, item }),
    remove: (ownerId, key) => client.mutation(api.savedItems.remove, { ownerId, key }),
    clear: (ownerId) => client.mutation(api.savedItems.clear, { ownerId }),
  };
}

async function respond(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), { status: 200 });
  } catch (error) {
    if (error instanceof SavedError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Saved items couldn't be reached right now. Your list is still kept in Chrome." }, { status: 502 });
  }
}

async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new SavedError("Request body must be JSON.", 400);
  }
}

export async function GET(request: Request) {
  return respond(() => listSaved(store(), new URL(request.url).searchParams.get("owner")));
}

export async function POST(request: Request) {
  return respond(async () => saveItem(store(), await body(request)));
}

export async function DELETE(request: Request) {
  return respond(async () => removeSaved(store(), await body(request)));
}
