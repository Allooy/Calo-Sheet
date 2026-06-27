export function LeafLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id="leafG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#aee3ca" />
          <stop offset="100%" stopColor="#52B788" />
        </linearGradient>
      </defs>
      <path
        d="M24 4C12 8 6 18 6 28c0 8 6 16 18 16s18-8 18-16C42 18 36 8 24 4z"
        fill="url(#leafG)"
        opacity="0.95"
      />
      <path
        d="M24 10c-6 4-10 12-10 20 0 6 3 11 10 14 7-3 10-8 10-14 0-8-4-16-10-20z"
        fill="#ffffff"
        opacity="0.22"
      />
      <path d="M24 14v26M16 24l8 4 8-4M18 32l6 2 6-2" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}