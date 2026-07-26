import type { ReactNode } from "react";

/** Shared glass card used by every panel, so spacing stays consistent. */
export function Card({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={bodyClassName || "px-4 pb-4"}>{children}</div>
    </section>
  );
}

/** Simple skeleton block for loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.07] ${className}`} />;
}
