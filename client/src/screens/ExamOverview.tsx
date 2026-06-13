import { ArrowRight, BookOpenText, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ExamApi, ExamDetail } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";

type ExamQuestionCount = 1 | 2 | 3 | 5;

const allowedCounts: ExamQuestionCount[] = [1, 2, 3, 5];

export function ExamOverview({ api = defaultApi }: { api?: ExamApi }) {
  const { examId = "" } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [questionCount, setQuestionCount] = useState<ExamQuestionCount>(1);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getExam(examId).then(setExam).catch((reason: Error) => setError(reason.message));
  }, [api, examId]);

  return (
    <AppShell>
      <main className="page overview-page">
        {error && <ErrorState message={error} />}
        {!exam && !error && <LoadingState />}
        {exam && (
          <section className="mode-section compact-mode-section" aria-labelledby="mode-heading">
            <div className="section-heading compact-heading">
              <p className="eyebrow">{exam.title}</p>
              <h1 id="mode-heading">Выберите режим</h1>
            </div>

            <div className="mode-grid mode-grid-two">
              <Link
                to={`/exams/${exam.id}/workspace/${exam.questions[0]?.id ?? "random"}?mode=study`}
                className="mode-card"
              >
                <BookOpenText size={25} />
                <span className="mode-number">01</span>
                <h2>Изучение</h2>
                <p>Выбирайте вопросы, сверяйтесь с ответами и сохраняйте заметки.</p>
                <span className="mode-action">Открыть изучение <ArrowRight size={16} /></span>
              </Link>

              <article className="mode-card exam-mode-card">
                <GraduationCap size={25} />
                <span className="mode-number">02</span>
                <h2>Экзамен</h2>
                <p>Ответьте на случайные вопросы без доступа к эталону до проверки.</p>
                <fieldset className="question-count-picker">
                  <legend>Количество вопросов</legend>
                  <div>
                    {allowedCounts.map((count) => (
                      <label key={count}>
                        <input
                          type="radio"
                          name="question-count"
                          value={count}
                          checked={questionCount === count}
                          onChange={() => setQuestionCount(count)}
                        />
                        <span>{count}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button
                  type="button"
                  className="mode-action mode-button"
                  onClick={() => navigate(
                    `/exams/${exam.id}/workspace/random?mode=exam&count=${questionCount}`,
                  )}
                >
                  Открыть экзамен <ArrowRight size={16} />
                </button>
              </article>
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
