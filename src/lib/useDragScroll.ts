import { useEffect, type RefObject } from "react";

// Hold right mouse button + drag to pan a scroll container (both axes).
// Also swallows the context menu on that element so right-click drags don't pop it.
export function useDragScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = false;
    let startX = 0, startY = 0, startL = 0, startT = 0, pid = -1;

    const down = (e: PointerEvent) => {
      if (e.button !== 2) return;
      active = true;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startL = el.scrollLeft; startT = el.scrollTop;
      el.setPointerCapture?.(pid);
      el.style.cursor = "grabbing";
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      el.scrollLeft = startL - (e.clientX - startX);
      el.scrollTop = startT - (e.clientY - startY);
    };
    const end = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      el.style.cursor = "";
      try { el.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    const ctx = (e: MouseEvent) => e.preventDefault();

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("contextmenu", ctx);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("contextmenu", ctx);
    };
  }, [ref]);
}
