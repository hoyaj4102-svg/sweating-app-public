import type { DemoClass } from "./demo-data";
import type { GenderCapacity } from "./capacity";

/** In-memory only. No fetch, no storage. A page refresh resets it. */
let created: readonly DemoClass[] = [];
const capacities = new Map<string, GenderCapacity>();
const listeners = new Set<() => void>();

export const getCreated = () => created;
export const getCreatedCapacity = (id: string) => capacities.get(id);
export function subscribeDemo(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function addCreated(entry: DemoClass, cap: GenderCapacity) {
  capacities.set(entry.item.id, cap);
  created = [entry, ...created];
  listeners.forEach(fn => fn());
}
