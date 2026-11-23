// Guided tours (antd Tour). Each page tour opens once on the first visit and can be
// replayed from the header. Storage can be unavailable, so failures fall back to "seen"
// for reads (never nag) and are ignored for writes.

export const TOUR_KEYS = { crm: 'tour:crm:v1', process: 'tour:process:v1' } as const;

export function tourSeen(key: string): boolean {
  try { return localStorage.getItem(key) === 'seen'; } catch { return true; }
}

export function markTourSeen(key: string) {
  try { localStorage.setItem(key, 'seen'); } catch { /* ignore */ }
}

/** Tour targets are looked up lazily, so steps can point at elements that render later. */
// antd types targets as () => HTMLElement; a missing element (null) just centers the step.
export const tourTarget = (name: string) => () => document.querySelector<HTMLElement>(`[data-tour="${name}"]`) as HTMLElement;
