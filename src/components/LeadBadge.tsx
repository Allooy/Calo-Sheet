import { Crown } from "lucide-react";

/**
 * Marks a shift lead. `full` shows a "Lead" pill; `icon` shows just a crown
 * chip (for tight spots like the admin grid).
 */
export function LeadBadge({ variant = "full" }: { variant?: "full" | "icon" }) {
  if (variant === "icon") {
    return (
      <span
        className="inline-grid place-items-center w-4 h-4 rounded-full shrink-0"
        style={{ background: "#fde68a", color: "#92400e" }}
        title="Shift lead"
        aria-label="Shift lead"
      >
        <Crown size={10} strokeWidth={2.5} fill="currentColor" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0"
      style={{ background: "#fef3c7", color: "#92400e" }}
      title="Shift lead"
    >
      <Crown size={11} strokeWidth={2.5} fill="currentColor" />
      Lead
    </span>
  );
}
