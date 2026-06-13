import { Award, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import type { AIReview, Attempt } from "../../../shared/contracts.js";
import type { ExamApi } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

export function History({ api = defaultApi }: { api?: ExamApi }) {
  const [data, setData] = useState<{ attempts: Attempt[]; reviews: AIReview[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getHistory().then(setData).catch((reason: Error) => setError(reason.message));
  }, [api]);

  const totalXp = data?.attempts.reduce((sum, attempt) => sum + attempt.xp, 0) ?? 0;

  return (
    <AppShell>
      <main className="page history-page">
        <section className="page-intro compact">
          <p className="eyebrow">Журнал подготовки</p>
          <h1>История попыток</h1>
          <p className="lead">Оценки привязаны к версии пакета, модели, промпта и схеме проверки.</p>
        </section>
        {error && <ErrorState message={error} />}
        {!data && !error && <LoadingState />}
        {data && (
          <>
            <div className="history-summary">
              <div><CalendarDays size={20} /><span>Завершено</span><strong>{data.attempts.length}</strong></div>
              <div><Award size={20} /><span>Накоплено</span><strong>{totalXp} XP</strong></div>
            </div>
            <section className="history-list">
              {data.attempts.length === 0 && <div className="empty-state"><h2>Здесь появятся завершённые ответы</h2><p>Черновики без итоговой отправки в историю не попадают.</p></div>}
              {data.attempts.map((attempt, index) => {
                const review = data.reviews[index];
                return (
                  <article className="history-item" key={attempt.id}>
                    <div className="history-date">{new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(attempt.createdAt))}</div>
                    <div><p className="eyebrow">{attempt.questionTitle ?? attempt.questionId}</p><h2>{review?.personaVerdict ?? "Ответ сохранён"}</h2><p>{review?.advice}</p></div>
                    <div className="history-score">{attempt.baseScore !== undefined ? <><strong>{attempt.baseScore}</strong><span>/100</span></> : <span>без оценки</span>}<small>+{attempt.xp} XP</small></div>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
