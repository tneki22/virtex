import { ArrowUpRight, BookMarked } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ExamApi, ExamSummary } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

export function ExamLibrary({ api = defaultApi }: { api?: ExamApi }) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.listExams().then(setExams).catch((reason: Error) => setError(reason.message));
  }, [api]);

  return (
    <AppShell>
      <main className="page library-page">
        <section className="page-intro">
          <p className="eyebrow">Локальная экзаменационная лаборатория</p>
          <h1>Готовьтесь по источникам,<br />а не по догадкам.</h1>
          <p className="lead">
            Каждый экзамен — отдельный проверяемый пакет вопросов, эталонов и документов.
            Прогресс остаётся на этом устройстве.
          </p>
        </section>

        {error && <ErrorState message={error} />}
        {!exams && !error && <LoadingState label="Проверяем экзаменационные пакеты" />}
        {exams && (
          <section className="exam-grid" aria-label="Доступные экзамены">
            {exams.map((exam, index) => {
              const progress = exam.questionCount
                ? Math.round((exam.readyCount / exam.questionCount) * 100)
                : 0;
              return (
                <Link
                  to={`/exams/${exam.id}`}
                  className="exam-card"
                  key={exam.id}
                  style={{ "--card-index": index } as React.CSSProperties}
                >
                  <div className="exam-card-topline">
                    <span className="subject-tag">{exam.subject}</span>
                    <ArrowUpRight size={20} />
                  </div>
                  <div className="exam-monogram"><BookMarked size={28} /></div>
                  <h2>{exam.title}</h2>
                  <p>{exam.description}</p>
                  <div className="exam-card-meta">
                    <span>{exam.questionCount} вопросов</span>
                    <span>версия {exam.version}</span>
                  </div>
                  <div className="progress-track" aria-label={`Готовность ${progress}%`}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <strong className="progress-caption">{exam.readyCount} готовы к ответу</strong>
                </Link>
              );
            })}
          </section>
        )}
      </main>
    </AppShell>
  );
}
