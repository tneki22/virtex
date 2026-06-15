interface ConfirmDialogProps {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  error?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  cancelLabel,
  confirmLabel,
  error,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-backdrop">
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <p className="eyebrow">Активная серия</p>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        {error && <p className="confirm-dialog-error" role="alert">{error}</p>}
        <div className="confirm-dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="primary-button" disabled={busy} onClick={onConfirm}>
            {busy ? "Прерываем…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
