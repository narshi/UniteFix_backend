/**
 * "My plan" — the client's Celebrations basket, kept in this browser until
 * they send it: a hall, a photographer and a planner for the same day, asked
 * for in one go. Nothing here is a booking; sending creates the requests.
 */

export type PlanItem = {
  type: "hall" | "photographer" | "planner";
  code: string; name: string; date: string; detail: string; photo: string | null;
  payload: Record<string, unknown>; estimate: number | null; guests: number | null; occasion: string | null;
};
const KEY = "uf-celebrations-plan";

export function readPlan(): PlanItem[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function writePlan(items: PlanItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 6))); } catch { /* private window: the plan lives for this page only */ }
}
/** One item per partner: adding the same partner again replaces it. */
export function addToPlan(item: PlanItem) {
  writePlan([...readPlan().filter(x => !(x.type === item.type && x.code === item.code)), item]);
}
export function removeFromPlan(type: string, code: string) {
  writePlan(readPlan().filter(x => !(x.type === type && x.code === code)));
}
export function clearPlan() { writePlan([]); }
