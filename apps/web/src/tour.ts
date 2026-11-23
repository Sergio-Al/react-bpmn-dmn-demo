import { useEffect, useRef } from 'react';

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

/**
 * Keyboard support the antd 5.21 Tour lacks: Esc closes, arrow keys step through.
 * Esc always closes; arrows are ignored while a form control has focus.
 */
export function useTourKeys(open: boolean, step: number, total: number, actions: { close: () => void; go: (step: number) => void }) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latest.current.close(); return; }
      // Arrow keys belong to form controls (text fields, radios, segmented switches) while they have focus.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="radio"], [role="radiogroup"], [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight' && step < total - 1) { event.preventDefault(); latest.current.go(step + 1); }
      else if (event.key === 'ArrowLeft' && step > 0) { event.preventDefault(); latest.current.go(step - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step, total]);
}
