export function EmptyIllustration({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <circle cx="60" cy="60" r="56" fill="#f0faf5" />
      <path
        d="M40 70c0-11 9-20 20-20s20 9 20 20"
        stroke="#52B788"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="50" cy="55" r="3" fill="#2d7a56" />
      <circle cx="70" cy="55" r="3" fill="#2d7a56" />
      <path d="M30 38c4-6 12-6 16 0M74 38c4-6 12-6 16 0" stroke="#aee3ca" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}