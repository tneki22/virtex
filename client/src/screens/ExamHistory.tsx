import { ArrowLeft, Award, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExamHistoryDetail } from "../../../shared/contracts.js";
import type { ExamApi } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

export function ExamHistory({ api = defaultApi }: { api?: ExamApi }) {
  const { runId = "" } = useParams();
  const [detail, setDetail] = useState<ExamHistoryDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getExamHistory(runId).then(setDetail).catch((reason: Error) => setError(reason.message));
  }, [api, runId]);

  return (
    <AppShell>
      <main className="page exam-history-page">
        <Link to="/history" className="back-link"><ArrowLeft size={15} /> К истории</Link>
        {error && <ErrorState message={error} />}
        {!detail && !error && <LoadingState label="Открываем результаты экзамена" />}
        {detail && (
          <>
            <section className="page-intro compact">
              <p className="eyebrow">Завершённый экзамен</p>
              <h1>{detail.summary.examTitle}</h1>
            </section>
            <div className="history-summary exam-history-summary">
              <div><CalendarDays size={20} /><span>Вопросов</span><strong>{detail.summary.questionCount}</strong></div>
              <div><Award size={20} /><span>Средний балл</span><strong>{detail.summary.averageScore === undefined ? "—" : `${Math.round(detail.summary.averageScore)}/100`}</strong></div>
              <div><Award size={20} /><span>Получено</span><strong>{detail.summary.totalXp} XP</strong></div>
            </div>
            <section className="exam-history-results" aria-label="Результаты по вопросам">
              {detail.items.map((item) => (
                <details className="exam-history-result" open key={item.position}>
                  <summary>
                    <span>{String(item.position).padStart(2, "0")}</span>
                    <strong>{item.questionTitle}</strong>
                    <small>{item.baseScore === undefined ? "без оценки" : `${item.baseScore}/100`} · +{item.xp} XP</small>
                  </summary>
                  <div className="exam-history-result-body">
                    <section><p className="eyebrow">Формулировка</p><p>{item.officialText}</p></section>
                    <section><p className="eyebrow">Ваш ответ</p><p>{item.answer}</p></section>
                    <section><p className="eyebrow">Итоговый отзыв</p><h3>{item.review.personaVerdict}</h3><p>{item.review.examinerMessage}</p><p>{item.review.advice}</p></section>
                  </div>
                </details>
              ))}
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
