export function LoadingState({ label = "Загрузка материалов" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-line" />
      <p>{label}</p>
    </div>
  );
}
