export function ErrorState({ message, title = "Не удалось загрузить данные" }: {
  message: string;
  title?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}
