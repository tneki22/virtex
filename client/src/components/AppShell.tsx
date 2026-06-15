import type { PropsWithChildren } from "react";

export function AppShell({ children }: PropsWithChildren) {
  return <div className="app-shell">{children}</div>;
}

export function LoadingState({ label = "Загрузка материалов" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-line" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state" role="alert">
      <strong>Не удалось загрузить данные</strong>
      <p>{message}</p>
    </div>
  );
}
