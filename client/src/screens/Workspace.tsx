import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronRight,
  Menu,
  MessageSquare,
  Mic,
  PanelRightOpen,
  Search,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ExamQuestionCount,
  ExamRun,
  ExamRunSummary as ExamRunSummaryData,
  StudyMode,
  StudySession,
} from "../../../shared/contracts.js";
import { assertExamQuestionCount } from "../../../shared/exam-run.js";
import { readinessFromScore } from "../../../shared/progress.js";
import { normalizeStudyMode } from "../../../shared/study-mode.js";
import type { ExamApi, ExamDetail, QuestionDetail, ReviewResponse } from "../api.js";
import { api as defaultApi } from "../api.js";
import { ErrorState, LoadingState } from "../components/AppShell.js";
import { ExaminerProfilePicker } from "../components/ExaminerProfilePicker.js";
import { ExamRunSummary } from "../components/ExamRunSummary.js";
import { PanelResizeHandle } from "../components/PanelResizeHandle.js";
import { ProgressiveText } from "../components/ProgressiveText.js";
import { MIN_LEFT, MIN_RIGHT, usePanelLayout } from "../hooks/usePanelLayout.js";
import { useVoiceInput } from "../hooks/useVoiceInput.js";

type RightTab = "answers" | "notes";
type DialogueTurn = {
  id: string;
  role: "student" | "examiner";
  text: string;
};

const modeLabels: Record<StudyMode, string> = {
  study: "Изучение",
  exam: "Экзамен",
};

const readinessLabels = {
  not_started: "Не начат",
  review: "Повторить",
  almost_ready: "Почти готов",
  ready: "Готов",
};

export function Workspace({ api = defaultApi }: { api?: ExamApi }) {
  const { examId = "", questionId: routeQuestionId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = normalizeStudyMode(searchParams.get("mode"));
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState(routeQuestionId);
  const [session, setSession] = useState<StudySession | null>(null);
  const [profileId, setProfileId] = useState("");
  const [answer, setAnswer] = useState("");
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [dialogueTurns, setDialogueTurns] = useState<DialogueTurn[]>([]);
  const [completed, setCompleted] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("answers");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState("");
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const panelLayout = usePanelLayout();
  const runId = searchParams.get("run");
  const questionCount = useMemo<ExamQuestionCount>(() => {
    try {
      return assertExamQuestionCount(Number(searchParams.get("count") ?? 1));
    } catch {
      return 1;
    }
  }, [searchParams]);
  const [examRun, setExamRun] = useState<ExamRun | null>(null);
  const [examSummary, setExamSummary] = useState<ExamRunSummaryData | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const voiceInput = useVoiceInput({
    api,
    questionId: question?.id ?? "",
    onTranscript: (text) => setAnswer((current) => current.trim()
      ? `${current.trimEnd()}\n\n${text}`
      : text),
  });

  useEffect(() => {
    void api
      .getExam(examId)
      .then((loadedExam) => {
        setExam(loadedExam);
        setProfileId((current) => current || loadedExam.profiles[0]?.id || "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId]);

  useEffect(() => {
    if (!runId || examRun?.id === runId) return;
    void api.getExamRun(runId)
      .then((step) => {
        setExamRun(step.run);
        setExamSummary(step.summary ?? null);
        setProfileId(step.run.profileId);
        if (step.session) {
          setSession(step.session);
          setSelectedQuestionId(step.session.questionId);
          if (routeQuestionId !== step.session.questionId) {
            navigate(
              `/exams/${examId}/workspace/${step.session.questionId}?mode=exam&run=${runId}`,
              { replace: true },
            );
          }
        }
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId, examRun?.id, navigate, routeQuestionId, runId]);

  useEffect(() => {
    if (routeQuestionId && routeQuestionId !== "random") {
      setSelectedQuestionId(routeQuestionId);
    }
  }, [routeQuestionId]);

  useEffect(() => {
    if (!selectedQuestionId || selectedQuestionId === "random") return;
    setQuestion(null);
    setReview(null);
    setDialogueTurns([]);
    setCompleted(false);
    void api
      .getQuestion(examId, selectedQuestionId)
      .then((loadedQuestion) => {
        setQuestion(loadedQuestion);
        setNote(loadedQuestion.note);
        const draftKey = `virtex:draft:${examId}:${loadedQuestion.id}:${runId ?? mode}`;
        setAnswer(localStorage.getItem(draftKey) ?? "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId, mode, runId, selectedQuestionId]);

  const answersLocked = mode === "exam" && !completed;

  useEffect(() => {
    if (!question) return;
    localStorage.setItem(`virtex:draft:${examId}:${question.id}:${runId ?? mode}`, answer);
  }, [answer, examId, mode, question, runId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "[") setLeftOpen((value) => !value);
      if (event.key === "]") setRightOpen((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredQuestions = useMemo(() => {
    if (!exam) return [];
    const normalized = search.trim().toLocaleLowerCase("ru");
    return exam.questions.filter(
      (item) =>
        !normalized ||
        item.displayText.toLocaleLowerCase("ru").includes(normalized) ||
        String(item.officialNumber).includes(normalized),
    );
  }, [exam, search]);

  async function ensureSession(): Promise<StudySession> {
    if (session && session.questionId === question?.id) return session;
    if (!question) throw new Error("Вопрос ещё не загружен");
    const created = await api.createSession({
      examId,
      questionId: question.id,
      mode,
      profileId,
    });
    setSession(created);
    return created;
  }

  async function submitAnswer() {
    if (!answer.trim() || !question || loadingReview || completed) return;
    const submittedAnswer = answer.trim();
    const submittedTurn: DialogueTurn = {
      id: crypto.randomUUID(),
      role: "student",
      text: submittedAnswer,
    };
    setDialogueTurns((turns) => [...turns, submittedTurn]);
    setLoadingReview(true);
    setError("");
    try {
      const currentSession = await ensureSession();
      const result = await api.review(currentSession.id, submittedAnswer);
      setReview(result);
      setDialogueTurns((turns) => [
        ...turns,
        { id: crypto.randomUUID(), role: "examiner", text: result.examinerMessage },
      ]);
      if (result.action === "clarify") {
        setAnswer("");
      } else {
        setCompleted(true);
        setQuestion((current) => {
          if (!current) return current;
          const bestScore = result.baseScore === undefined
            ? current.progress.bestScore
            : Math.max(current.progress.bestScore ?? 0, result.baseScore);
          return {
            ...current,
            progress: {
              attempts: current.progress.attempts + 1,
              ...(bestScore === undefined ? {} : { bestScore }),
              readiness: readinessFromScore(bestScore),
            },
          };
        });
        localStorage.removeItem(`virtex:draft:${examId}:${question.id}:${runId ?? mode}`);
      }
    } catch (reason) {
      setDialogueTurns((turns) => turns.filter((turn) => turn.id !== submittedTurn.id));
      setError(reason instanceof Error ? reason.message : "Не удалось проверить ответ");
    } finally {
      setLoadingReview(false);
    }
  }

  function startNewAttempt() {
    if (!question) return;
    setSession(null);
    setReview(null);
    setDialogueTurns([]);
    setCompleted(false);
    setAnswer("");
    localStorage.removeItem(`virtex:draft:${examId}:${question.id}:${runId ?? mode}`);
  }

  function selectQuestion(id: string) {
    if (mode === "exam") return;
    setSelectedQuestionId(id);
    setSession(null);
    setLeftOpen(false);
    navigate(`/exams/${examId}/workspace/${id}?mode=${mode}`);
  }

  async function toggleBookmark() {
    if (!question) return;
    const result = await api.updateBookmark(question.id, !question.bookmarked);
    setQuestion({ ...question, bookmarked: result.bookmarked });
  }

  async function saveNote() {
    if (!question) return;
    await api.updateNote(question.id, note);
  }

  async function startExamRun() {
    if (!exam || !profileId || loadingRun) return;
    setLoadingRun(true);
    setError("");
    try {
      const step = await api.createExamRun({
        examId: exam.id,
        profileId,
        questionCount,
      });
      if (!step.session) throw new Error("Сервер не вернул первый вопрос экзамена");
      setExamRun(step.run);
      setSession(step.session);
      navigate(
        `/exams/${exam.id}/workspace/${step.session.questionId}?mode=exam&run=${step.run.id}`,
        { replace: true },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось начать экзамен");
    } finally {
      setLoadingRun(false);
    }
  }

  async function advanceExamRun() {
    if (!examRun || loadingRun) return;
    setLoadingRun(true);
    setError("");
    try {
      const step = await api.advanceExamRun(examRun.id);
      setExamRun(step.run);
      if (step.summary) {
        setExamSummary(step.summary);
        return;
      }
      if (!step.session) throw new Error("Сервер не вернул следующий вопрос");
      setSession(step.session);
      setSelectedQuestionId(step.session.questionId);
      setReview(null);
      setDialogueTurns([]);
      setCompleted(false);
      setAnswer("");
      navigate(
        `/exams/${examId}/workspace/${step.session.questionId}?mode=exam&run=${examRun.id}`,
        { replace: true },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось продолжить экзамен");
    } finally {
      setLoadingRun(false);
    }
  }

  if (error && !exam) return <ErrorState message={error} />;
  if (!exam) return <LoadingState label="Открываем рабочее пространство" />;
  if (mode === "exam" && routeQuestionId === "random") {
    return (
      <div className="workspace-page exam-setup-page">
        <header className="workspace-header">
          <Link to={`/exams/${exam.id}`} className="workspace-brand"><ArrowLeft size={17} /> Virtex</Link>
          <div className="workspace-title"><span>{exam.title}</span><ChevronRight size={14} /><strong>Экзамен</strong></div>
        </header>
        <main className="exam-setup-card">
          <p className="eyebrow">{questionCount} {questionCount === 1 ? "вопрос" : "вопроса"}</p>
          <h1>Настройка экзамена</h1>
          <p>Вопросы выбираются случайно и не повторяются в пределах серии.</p>
          <ExaminerProfilePicker
            profiles={exam.profiles}
            value={profileId}
            onChange={setProfileId}
          />
          {error && <ErrorState message={error} />}
          <button className="primary-button" disabled={loadingRun} onClick={() => void startExamRun()}>
            {loadingRun ? "Запускаем…" : "Начать экзамен"}
          </button>
        </main>
      </div>
    );
  }
  if (examSummary) {
    return (
      <div className="workspace-page exam-summary-page">
        <header className="workspace-header">
          <Link to={`/exams/${exam.id}`} className="workspace-brand"><ArrowLeft size={17} /> Virtex</Link>
          <div className="workspace-title"><span>{exam.title}</span><ChevronRight size={14} /><strong>Итоги</strong></div>
        </header>
        <main><ExamRunSummary examId={exam.id} summary={examSummary} questions={exam.questions} /></main>
      </div>
    );
  }
  if (!question) return <LoadingState label="Открываем рабочее пространство" />;

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <Link to={`/exams/${exam.id}`} className="workspace-brand"><ArrowLeft size={17} /> Virtex</Link>
        <div className="workspace-title">
          <span>{exam.title}</span>
          <ChevronRight size={14} />
          <strong>{modeLabels[mode]}</strong>
        </div>
        <div className="workspace-tools">
          <button className="icon-button tablet-only" onClick={() => setLeftOpen(true)} aria-label="Открыть список вопросов"><Menu size={19} /></button>
          <button className="icon-button tablet-only" onClick={() => setRightOpen(true)} aria-label="Открыть ответы и заметки"><PanelRightOpen size={19} /></button>
        </div>
      </header>

      <div
        className="workspace-grid"
        style={{
          "--left-panel": `${panelLayout.layout.left}px`,
          "--right-panel": `${panelLayout.layout.right}px`,
        } as CSSProperties}
      >
        <aside className={`question-panel ${leftOpen ? "is-open" : ""}`} aria-label="Навигация по вопросам">
          <div className="panel-mobile-head"><strong>Вопросы</strong><button className="icon-button" onClick={() => setLeftOpen(false)} aria-label="Закрыть список"><X size={18} /></button></div>
          <div className="question-search">
            <Search size={16} />
            <input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер или тема" aria-label="Поиск вопросов" />
            <kbd>/</kbd>
          </div>
          <div className="question-panel-caption">
            <span>{filteredQuestions.length} вопросов</span>
            <span>{mode === "exam" ? "выбран случайно" : "ручной выбор"}</span>
          </div>
          <div className="question-list">
            {filteredQuestions.map((item) => (
              <button
                key={item.id}
                className={`question-list-item ${item.id === question.id ? "is-active" : ""}`}
                onClick={() => selectQuestion(item.id)}
                disabled={mode === "exam"}
                aria-label={`Вопрос ${item.officialNumber}: ${item.displayText}`}
              >
                <span className="question-number">{String(item.officialNumber).padStart(2, "0")}</span>
                <span><strong>Вопрос {item.officialNumber}</strong><small>{item.groupTitle.replace(/^Модуль [A-ZА-Я]:\s*/u, "")}</small></span>
                <span className="question-state" />
              </button>
            ))}
          </div>
        </aside>

        <PanelResizeHandle
          label="Изменить ширину списка вопросов"
          value={panelLayout.layout.left}
          min={MIN_LEFT}
          max={panelLayout.limits.leftMax}
          onChange={(value) => panelLayout.setSide("left", value)}
          onPointerStart={(event) => panelLayout.startResize("left", event)}
          onReset={panelLayout.reset}
        />

        <main className="answer-panel">
          <div className="question-heading-row">
            <div>
              <p className="eyebrow">Вопрос {question.officialNumber} · {question.groupTitle}</p>
              <h1>{question.displayText}</h1>
              {question.officialText !== question.displayText && (
                <details className="official-wording"><summary>Официальная формулировка</summary><p>{question.officialText}</p></details>
              )}
            </div>
            <button className="icon-button bookmark-button" onClick={() => void toggleBookmark()} aria-label={question.bookmarked ? "Убрать из закладок" : "Добавить в закладки"}>
              {question.bookmarked ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
            </button>
          </div>

          <div className="readiness-strip">
            <span className={`readiness-dot ${question.progress.readiness}`} />
            {readinessLabels[question.progress.readiness]}
            {question.progress.bestScore !== undefined && <strong>{question.progress.bestScore}/100</strong>}
            {examRun && <strong>{examRun.currentPosition} из {examRun.questionCount}</strong>}
            <span>{question.progress.attempts} попыток</span>
          </div>

          <ExaminerProfilePicker
            profiles={exam.profiles}
            value={profileId}
            disabled={Boolean(session || examRun)}
            onChange={setProfileId}
          />

          <section className="answer-editor-section">
            <div className="editor-label"><span>{review?.action === "clarify" ? "Ваше уточнение" : "Ваш ответ"}</span><small>{completed ? "Попытка завершена" : "Черновик сохраняется локально"}</small></div>
            {dialogueTurns.length > 0 && (
              <div className="dialogue-trail" aria-label="Предыдущие реплики">
                {dialogueTurns.map((turn) => (
                  <div className={`dialogue-turn role-${turn.role}`} key={turn.id}>
                    <strong>{turn.role === "student" ? "Вы" : "Экзаменатор"}</strong>
                    {turn.role === "examiner"
                      ? <ProgressiveText text={turn.text} />
                      : <p>{turn.text}</p>}
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={answer}
              disabled={completed}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submitAnswer();
              }}
              placeholder={mode === "study" ? "Сформулируйте ответ своими словами…" : "Отвечайте так, как говорили бы на экзамене…"}
              aria-label="Ответ на вопрос"
            />
            <div className="editor-footer">
              <div className="editor-meta">
                <span>{answer.trim().split(/\s+/).filter(Boolean).length} слов</span>
                <button
                  type="button"
                  className={`voice-button ${voiceInput.status === "recording" ? "is-recording" : ""}`}
                  disabled={completed || voiceInput.status === "transcribing"}
                  onClick={() => void voiceInput.toggle()}
                >
                  {voiceInput.status === "recording" ? <Square size={14} /> : <Mic size={15} />}
                  {voiceInput.status === "recording"
                    ? `Стоп ${Math.floor(voiceInput.durationSeconds / 60)}:${String(voiceInput.durationSeconds % 60).padStart(2, "0")}`
                    : voiceInput.status === "transcribing" ? "Распознаём…" : "Диктовать"}
                </button>
                {voiceInput.error && <span className="voice-error">{voiceInput.error}</span>}
              </div>
              <button className="primary-button" disabled={!answer.trim() || loadingReview || completed} onClick={() => void submitAnswer()}>
                {loadingReview ? <><span className="button-spinner" /> Проверяем</> : <><Send size={17} /> {review?.action === "clarify" ? "Ответить на уточнение" : "Отправить ответ"}</>}
              </button>
            </div>
          </section>

          {error && <ErrorState message={error} />}

          {review && (
            <section className={`review-card action-${review.action}`} aria-live="polite">
              <div className="review-header">
                <span className="review-icon">{review.action === "final" ? <CheckCircle2 size={20} /> : <Sparkles size={20} />}</span>
                <div><p className="eyebrow">Ответ экзаменатора</p><strong>{review.personaVerdict}</strong></div>
                {review.baseScore !== undefined && <div className="score-seal"><strong>{review.baseScore}</strong><span>/100</span></div>}
              </div>
              {(review.strengths.length > 0 || review.gaps.length > 0 || review.errors.length > 0) && (
                <div className="review-columns staged-line">
                  <div><h3>Сильные стороны</h3>{review.strengths.map((item) => <p key={item}>+ {item}</p>)}</div>
                  <div><h3>Что дополнить</h3>{[...review.gaps, ...review.errors].map((item) => <p key={item}>− {item}</p>)}</div>
                </div>
              )}
              <p className="review-advice staged-line"><strong>Следующий шаг:</strong> {review.advice}</p>
              {review.xp > 0 && <span className="xp-badge">+{review.xp} XP</span>}
            </section>
          )}
          {completed && examRun && (
            <button className="primary-button new-attempt-button" disabled={loadingRun} onClick={() => void advanceExamRun()}>
              {examRun.currentPosition < examRun.questionCount
                ? `Следующий вопрос ${examRun.currentPosition + 1} из ${examRun.questionCount}`
                : "Завершить экзамен"}
            </button>
          )}
          {completed && !examRun && (
            <button className="secondary-button new-attempt-button" onClick={startNewAttempt}>Новая попытка</button>
          )}
        </main>

        <PanelResizeHandle
          label="Изменить ширину панели ответов"
          value={panelLayout.layout.right}
          min={MIN_RIGHT}
          max={panelLayout.limits.rightMax}
          onChange={(value) => panelLayout.setSide("right", value)}
          onPointerStart={(event) => panelLayout.startResize("right", event)}
          onReset={panelLayout.reset}
        />

        <aside className={`reference-panel ${rightOpen ? "is-open" : ""}`} aria-label="Ответы и заметки">
          <div className="panel-mobile-head"><strong>Ответы и заметки</strong><button className="icon-button" onClick={() => setRightOpen(false)} aria-label="Закрыть панель"><X size={18} /></button></div>
          <div className="reference-tabs" role="tablist">
            <button role="tab" aria-selected={rightTab === "answers"} disabled={answersLocked} onClick={() => setRightTab("answers")}>Ответы</button>
            <button role="tab" aria-selected={rightTab === "notes"} onClick={() => setRightTab("notes")}>Заметки</button>
          </div>
          <div className="reference-content">
            {rightTab === "answers" && (
              answersLocked ? (
                <div className="locked-state"><MessageSquare size={24} /><h2>Ответы закрыты</h2><p>Эталон станет доступен после итоговой проверки текущего вопроса.</p></div>
              ) : (
                <div className="reference-answer">
                  <p className="eyebrow">Эталон пакета</p>
                  <h2>Опорный ответ</h2>
                  <div className="reference-copy">
                    {question.referenceAnswer
                      .split(/\n{2,}|(?<=\.)\s+(?=\d+\.)/u)
                      .filter(Boolean)
                      .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </div>
              )
            )}
            {rightTab === "notes" && (
              <div className="notes-panel"><p className="eyebrow">Личная заметка</p><h2>Что важно запомнить</h2><textarea aria-label="Заметка" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Связи, мнемоника, сложные места…" /><button className="secondary-button" onClick={() => void saveNote()}>Сохранить заметку</button></div>
            )}
          </div>
        </aside>
      </div>
      {(leftOpen || rightOpen) && <button className="panel-backdrop tablet-only" aria-label="Закрыть панель" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
    </div>
  );
}
