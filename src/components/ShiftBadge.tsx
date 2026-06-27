import { categoryStyle, shiftCategory } from "@/lib/shifts";

export function ShiftBadge({
  code,
  size = "md",
  className = "",
}: {
  code: string | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const display = (code ?? "—").toString();
  const cat = shiftCategory(code);
  const s = categoryStyle(cat);
  const sizing =
    size === "xl"
      ? "text-[28px] px-6 py-3 gap-3"
      : size === "lg"
        ? "text-sm px-4 py-2 gap-2"
        : size === "sm"
          ? "text-[10px] px-2 py-0.5 gap-1"
          : "text-[11px] px-2.5 py-1 gap-1.5";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wide ${sizing} ${className}`}
      style={{ background: s.bg, color: s.text }}
    >
      <span
        className="rounded-full shrink-0"
        style={{
          background: s.dot,
          width: size === "xl" ? 12 : size === "lg" ? 8 : 6,
          height: size === "xl" ? 12 : size === "lg" ? 8 : 6,
        }}
      />
      {display}
    </span>
  );
}