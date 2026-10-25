// the saved list across tellr sessions: kept in chrome first (never lost when offline), and in
// convex through /api/saved. changes that haven't reached the server wait in a queue. plain
// logic, unit-tested; background.js does the storage and requests.

// pending: [{ op: "save", item } | { op: "remove", key } | { op: "clear" }], oldest first
export function queueOp(pending, op) {
  // a newer change to the same item replaces an older one still waiting; clearing replaces all
  if (op.op === "clear") return [op];
  const key = op.op === "save" ? op.item.key : op.key;
  return [...(pending || []).filter((p) => p.op === "clear" || (p.op === "save" ? p.item.key : p.key) !== key), op];
}

// the list to show: what the server has, with changes still waiting applied on top
export function mergeSaved(remote, pending) {
  let list = [...(remote || [])];
  for (const p of pending || []) {
    if (p.op === "clear") list = [];
    else if (p.op === "remove") list = list.filter((item) => item.key !== p.key);
    else {
      const at = list.findIndex((item) => item.key === p.item.key);
      list = at >= 0 ? list.map((item, i) => (i === at ? p.item : item)) : [...list, p.item];
    }
  }
  return list;
}

// fields the server accepts, so a save never fails on something extra
export function forServer(entry) {
  const text = (value, max) => String(value || "").slice(0, max);
  return {
    key: text(entry.key, 100),
    url: text(entry.url, 1000),
    title: text(entry.title || "Untitled item", 300),
    description: text(entry.description, 400),
    priceCents: Math.max(0, Math.round(Number(entry.priceCents) || 0)),
    fit: ["great_pick", "good_pick", "okay_pick", "risky", "not_a_match"].includes(entry.fit) ? entry.fit : "",
    flaw: text(entry.flaw, 300),
    unknown: text(entry.unknown, 300),
    kind: text(entry.kind, 30),
    savedAt: Math.round(Number(entry.savedAt) || Date.now()),
  };
}
