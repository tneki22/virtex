import type { PropsWithChildren } from "react";

interface StatusBadgeProps {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}

export function StatusBadge({
  tone = "neutral",
  className = "",
  children,
}: PropsWithChildren<StatusBadgeProps>) {
  return <span className={`status-badge tone-${tone} ${className}`.trim()}>{children}</span>;
}
