import { ArrowRight, BookOpenText, ExternalLink, FileText, GraduationCap, History as HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ExamMaterialFile, ExamQuestionCount } from "../../../shared/contracts.js";
import type { ExamApi, ExamDetail } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell, ErrorState, LoadingState } from "../components/AppShell.js";
import { AIProviderSettings } from "../components/AIProviderSettings.js";
import { PromptSettingsEditor } from "../components/PromptSettingsEditor.js";

const allowedCounts: ExamQuestionCount[] = [1, 2, 3, 5];

export function ExamOverview({ api = defaultApi }: { api?: ExamApi }) {
  const { examId = "" } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [materials, setMaterials] = useState<ExamMaterialFile[]>([]);
  const [questionCount, setQuestionCount] = useState<ExamQuestionCount>(1);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.getExam(examId).then(setExam).catch((reason: Error) => setError(reason.message));
  }, [api, examId]);

  useEffect(() => {
    void api.listMaterials().then(setMaterials).catch(() => setMaterials([]));
  }, [api]);

  return (
    <AppShell>
      <main className="page overview-page">
        {error && <ErrorState message={error} />}
        {!exam && !error && <LoadingState />}
        {exam && (
          <section className="mode-section compact-mode-section" aria-labelledby="mode-heading">
            <Link to="/history" className="overview-history-link"><HistoryIcon size={16} /> История</Link>
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
            {materials.length > 0 && (
              <section className="exam-materials-section" aria-labelledby="exam-materials-heading">
                <div>
                  <p className="eyebrow">Источники</p>
                  <h2 id="exam-materials-heading">Материалы к экзамену</h2>
                </div>
                <div className="exam-materials-list">
                  {materials.map((material) => (
                    <a
                      className="exam-material-link"
                      href={material.url}
                      target="_blank"
                      rel="noreferrer"
                      key={material.url}
                    >
                      <FileText size={18} />
                      <span>
                        <strong>{material.name}</strong>
                        <small>{formatFileSize(material.size)}</small>
                      </span>
                      <ExternalLink size={16} />
                    </a>
                  ))}
                </div>
              </section>
            )}
            <AIProviderSettings api={api} />
            <PromptSettingsEditor api={api} examId={exam.id} />
          </section>
        )}
      </main>
    </AppShell>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}
