import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: PropsWithChildren<ButtonProps>) {
  const variantClass = variant === "primary"
    ? "primary-button"
    : variant === "secondary"
      ? "secondary-button"
      : "text-button";
  return (
    <button className={`${variantClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
