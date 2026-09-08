import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export const GlassCard = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { children: ReactNode; hoverable?: boolean }
>(function GlassCard({ children, className = "", hoverable = false, ...rest }, ref) {
  return (
    <div
      ref={ref}
      {...rest}
      className={`glass rounded-2xl ${
        hoverable
          ? "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_42px_rgba(20,40,30,0.12)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
});
