import { gradientFor, initials } from "@/lib/shifts";

const SIZES = {
  sm: "w-8 h-8 text-[11px]",
  md: "w-10 h-10 text-[13px]",
  lg: "w-14 h-14 text-[18px]",
} as const;

export function Avatar({
  name,
  url,
  size = "md",
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        className={`${SIZES[size]} ${className} rounded-full object-cover shrink-0 shadow-sm ring-1 ring-white/40`}
      />
    );
  }
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
