import { ArrowLeft, Award, CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { HistoryData } from "../../../shared/contracts.js";
import type { ExamApi } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

const dateFormatter = new Intl.DateTimeFormat("ru", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function History({ api = defaultApi }: { api?: ExamApi }) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getHistory().then(setData).catch((reason: Error) => setError(reason.message));
  }, [api]);

  const totalXp = data
    ? data.examRuns.reduce((sum, run) => sum + run.totalXp, 0)
      + data.studyAttempts.reduce((sum, attempt) => sum + attempt.xp, 0)
    : 0;

  return (
    <AppShell>
      <main className="page history-page">
        <Link to="/" className="back-link"><ArrowLeft size={15} /> На главную</Link>
        <section className="page-intro compact">
          <p className="eyebrow">Журнал подготовки</p>
          <h1>История</h1>
        </section>
        {error && <ErrorState message={error} />}
        {!data && !error && <LoadingState label="Загружаем историю" />}
        {data && (
          <>
            <div className="history-summary">
              <div><CalendarDays size={20} /><span>Завершено</span><strong>{data.examRuns.length + data.studyAttempts.length}</strong></div>
              <div><Award size={20} /><span>Накоплено</span><strong>{totalXp} XP</strong></div>
            </div>

            <section className="history-section" aria-labelledby="exam-history-heading">
              <div className="history-section-heading">
                <p className="eyebrow">Серии вопросов</p>
                <h2 id="exam-history-heading">Экзамены</h2>
              </div>
              <div className="history-list">
                {data.examRuns.length === 0 && <div className="empty-state"><h3>Завершённых экзаменов пока нет</h3><p>Прерванные серии сюда не попадают.</p></div>}
                {data.examRuns.map((run) => (
                  <Link className="history-item history-exam-item" to={`/history/exams/${run.runId}`} key={run.runId}>
                    <div className="history-date">{dateFormatter.format(new Date(run.completedAt))}</div>
                    <div>
                      <p className="eyebrow">{run.questionCount} вопросов</p>
                      <h3>{run.examTitle}</h3>
                      <p>Полная серия завершена · +{run.totalXp} XP</p>
                    </div>
                    <div className="history-score">
                      {run.averageScore === undefined ? <span>без оценки</span> : <><strong>{Math.round(run.averageScore)}</strong><span>/100</span></>}
                      <ChevronRight size={17} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="history-section" aria-labelledby="study-history-heading">
              <div className="history-section-heading">
                <p className="eyebrow">Отдельные ответы</p>
                <h2 id="study-history-heading">Учебные проверки</h2>
              </div>
              <div className="history-list">
                {data.studyAttempts.length === 0 && <div className="empty-state"><h3>Учебных проверок пока нет</h3><p>Завершите проверку ответа в режиме изучения.</p></div>}
                {data.studyAttempts.map((attempt) => (
                  <article className="history-item" key={attempt.id}>
                    <div className="history-date">{dateFormatter.format(new Date(attempt.createdAt))}</div>
                    <div>
                      <p className="eyebrow">{attempt.questionTitle ?? attempt.questionId}</p>
                      <h3>{attempt.review.personaVerdict}</h3>
                      <p>{attempt.review.examinerMessage}</p>
                    </div>
                    <div className="history-score">
                      {attempt.baseScore === undefined ? <span>без оценки</span> : <><strong>{attempt.baseScore}</strong><span>/100</span></>}
                      <small>+{attempt.xp} XP</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
