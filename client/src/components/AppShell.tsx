import { BookOpen, Clock3, Library, Settings } from "lucide-react";
import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Virtex — подготовка">
          <span className="brand-mark">V</span>
          <span>
            <strong>Virtex</strong>
            <small>exam studio</small>
          </span>
        </NavLink>
        <nav className="primary-nav" aria-label="Основная навигация">
          <NavLink to="/" end>
            <Library size={17} /> Подготовка
          </NavLink>
          <NavLink to="/history">
            <Clock3 size={17} /> История
          </NavLink>
          <NavLink to="/settings">
            <Settings size={17} /> Настройки
          </NavLink>
        </nav>
        <div className="topbar-status" title="Локальное хранилище">
          <span className="status-dot" />
          <BookOpen size={16} />
          Локально
        </div>
      </header>
      {children}
    </div>
  );
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
