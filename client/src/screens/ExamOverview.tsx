import { ArrowLeft, ArrowRight, BookOpenText, GraduationCap, MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExamApi, ExamDetail } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

const modes = [
  {
    id: "study",
    title: "Изучение",
    description: "Источник, черновик и эталон в одном рабочем пространстве.",
    icon: BookOpenText,
  },
  {
    id: "practice",
    title: "Практика",
    description: "Ответьте без подсказки и получите уточнения экзаменатора.",
    icon: MessageSquareText,
  },
  {
    id: "exam",
    title: "Экзамен",
    description: "Один случайный вопрос. Источники закрыты до итогового ответа.",
    icon: GraduationCap,
  },
] as const;

export function ExamOverview({ api = defaultApi }: { api?: ExamApi }) {
  const { examId = "" } = useParams();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getExam(examId).then(setExam).catch((reason: Error) => setError(reason.message));
  }, [api, examId]);

  const groups = useMemo(() => {
    if (!exam) return [];
    return Array.from(new Map(exam.questions.map((question) => [question.groupId, question.groupTitle])).values());
  }, [exam]);

  return (
    <AppShell>
      <main className="page overview-page">
        <Link to="/" className="back-link"><ArrowLeft size={16} /> Все экзамены</Link>
        {error && <ErrorState message={error} />}
        {!exam && !error && <LoadingState />}
        {exam && (
          <>
            <section className="overview-hero">
              <div>
                <p className="eyebrow">{exam.subject} · пакет {exam.version}</p>
                <h1>{exam.title}</h1>
                <p className="lead">{exam.description}</p>
              </div>
              <dl className="overview-facts">
                <div><dt>Вопросы</dt><dd>{exam.questions.length}</dd></div>
                <div><dt>Разделы</dt><dd>{groups.length}</dd></div>
                <div><dt>Источники</dt><dd>{exam.documents.length}</dd></div>
              </dl>
            </section>

            <section className="mode-section">
              <div className="section-heading">
                <p className="eyebrow">Выберите сценарий</p>
                <h2>Как будете работать сегодня?</h2>
              </div>
              <div className="mode-grid">
                {modes.map(({ id, title, description, icon: Icon }) => {
                  const firstQuestion = exam.questions[0]?.id ?? "random";
                  const questionId = id === "exam" ? "random" : firstQuestion;
                  return (
                    <Link to={`/exams/${exam.id}/workspace/${questionId}?mode=${id}`} className="mode-card" key={id}>
                      <Icon size={24} />
                      <span className="mode-number">0{modes.findIndex((mode) => mode.id === id) + 1}</span>
                      <h3>{title}</h3>
                      <p>{description}</p>
                      <span className="mode-action">Начать <ArrowRight size={16} /></span>
                    </Link>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
