import { gradientFor, initials } from "@/lib/shifts";

const SIZES = {
  sm: "w-8 h-8 text-[11px]",
  md: "w-10 h-10 text-[13px]",
  lg: "w-14 h-14 text-[18px]",
} as const;

export function Avatar({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [a, b] = gradientFor(name);
  return (
    <div
      className={`${SIZES[size]} ${className} rounded-full grid place-items-center text-white font-bold shrink-0 shadow-sm ring-1 ring-white/40`}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}