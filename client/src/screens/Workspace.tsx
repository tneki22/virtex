import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  Menu,
  MessageSquare,
  PanelRightOpen,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { StudyMode, StudySession } from "../../../shared/contracts.js";
import { readinessFromScore } from "../../../shared/progress.js";
import { normalizeStudyMode } from "../../../shared/study-mode.js";
import type { ExamApi, ExamDetail, QuestionDetail, ReviewResponse } from "../api.js";
import { api as defaultApi } from "../api.js";
import { ErrorState, LoadingState } from "../components/AppShell.js";
import { PanelResizeHandle } from "../components/PanelResizeHandle.js";
import { MIN_LEFT, MIN_RIGHT, usePanelLayout } from "../hooks/usePanelLayout.js";

type RightTab = "sources" | "reference" | "notes";

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
  const [dialogueTurns, setDialogueTurns] = useState<Array<{ answer: string; message: string }>>([]);
  const [referenceRevealed, setReferenceRevealed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("sources");
  const [sourceText, setSourceText] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState("");
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [sourcePulse, setSourcePulse] = useState(false);
  const startedRandomExam = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const panelLayout = usePanelLayout();

  useEffect(() => {
    void api
      .getExam(examId)
      .then((loadedExam) => {
        setExam(loadedExam);
        setProfileId(loadedExam.profiles[0]?.id ?? "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId]);

  useEffect(() => {
    if (!exam || mode !== "exam" || routeQuestionId !== "random" || startedRandomExam.current) return;
    startedRandomExam.current = true;
    void api
      .createSession({ examId, mode, profileId: exam.profiles[0].id })
      .then((created) => {
        setSession(created);
        setSelectedQuestionId(created.questionId);
        navigate(`/exams/${examId}/workspace/${created.questionId}?mode=exam`, { replace: true });
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, exam, examId, mode, navigate, profileId, routeQuestionId]);

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
    setReferenceRevealed(false);
    void api
      .getQuestion(examId, selectedQuestionId)
      .then((loadedQuestion) => {
        setQuestion(loadedQuestion);
        setNote(loadedQuestion.note);
        const draftKey = `virtex:draft:${examId}:${loadedQuestion.id}:${mode}`;
        setAnswer(localStorage.getItem(draftKey) ?? "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId, mode, selectedQuestionId]);

  const sourcesLocked = mode === "exam" && !completed;
  const activeSource = question?.sources[0];

  useEffect(() => {
    if (!question || !activeSource || rightTab !== "sources" || sourcesLocked) return;
    setSourceText("");
    void api
      .getDocument(examId, activeSource.documentId, activeSource.page)
      .then((document) => setSourceText((document.fragments ?? []).map((fragment) => fragment.text).join("\n\n")))
      .catch((reason: Error) => setError(reason.message));
  }, [activeSource, api, examId, question, rightTab, sourcesLocked]);

  useEffect(() => {
    if (!question) return;
    localStorage.setItem(`virtex:draft:${examId}:${question.id}:${mode}`, answer);
  }, [answer, examId, mode, question]);

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
    setLoadingReview(true);
    setError("");
    try {
      const currentSession = await ensureSession();
      const result = await api.review(currentSession.id, submittedAnswer);
      setReview(result);
      if (result.action === "clarify") {
        setDialogueTurns((turns) => [...turns, { answer: submittedAnswer, message: result.examinerMessage }]);
        setAnswer("");
      } else {
        setCompleted(true);
        setReferenceRevealed(true);
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
        localStorage.removeItem(`virtex:draft:${examId}:${question.id}:${mode}`);
      }
    } catch (reason) {
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
    setReferenceRevealed(false);
    localStorage.removeItem(`virtex:draft:${examId}:${question.id}:${mode}`);
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

  function openCitation() {
    setRightTab("sources");
    setRightOpen(true);
    setSourcePulse(true);
    window.setTimeout(() => setSourcePulse(false), 700);
  }

  if (error && !exam) return <ErrorState message={error} />;
  if (!exam || !question) return <LoadingState label="Открываем рабочее пространство" />;

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
          <button className="icon-button tablet-only" onClick={() => setRightOpen(true)} aria-label="Открыть материалы"><PanelRightOpen size={19} /></button>
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)} aria-label="Профиль экзаменатора" disabled={Boolean(session)}>
            {exam.profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
          </select>
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
            {!referenceRevealed && mode !== "exam" && (
              <button
                className="inline-reveal"
                onClick={() => {
                  setReferenceRevealed(true);
                  setRightTab("reference");
                  setRightOpen(true);
                }}
              >
                Показать эталон
              </button>
            )}
            <span>{question.progress.attempts} попыток</span>
          </div>

          <section className="answer-editor-section">
            <div className="editor-label"><span>{review?.action === "clarify" ? "Ваше уточнение" : "Ваш ответ"}</span><small>{completed ? "Попытка завершена" : "Черновик сохраняется локально"}</small></div>
            {dialogueTurns.length > 0 && (
              <div className="dialogue-trail" aria-label="Предыдущие реплики">
                {dialogueTurns.map((turn, index) => (
                  <div className="dialogue-turn" key={`${index}-${turn.answer}`}>
                    <p><strong>Ваш ответ:</strong> {turn.answer}</p>
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
              <span>{answer.trim().split(/\s+/).filter(Boolean).length} слов</span>
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
              <p className="review-message staged-line">{review.examinerMessage}</p>
              {(review.strengths.length > 0 || review.gaps.length > 0 || review.errors.length > 0) && (
                <div className="review-columns staged-line">
                  <div><h3>Сильные стороны</h3>{review.strengths.map((item) => <p key={item}>+ {item}</p>)}</div>
                  <div><h3>Что дополнить</h3>{[...review.gaps, ...review.errors].map((item) => <p key={item}>− {item}</p>)}</div>
                </div>
              )}
              <p className="review-advice staged-line"><strong>Следующий шаг:</strong> {review.advice}</p>
              {review.citations.length > 0 && <button className="text-button" onClick={openCitation}><FileText size={15} /> Открыть источник проверки</button>}
              {review.xp > 0 && <span className="xp-badge">+{review.xp} XP</span>}
            </section>
          )}
          {completed && (
            <button className="secondary-button new-attempt-button" onClick={startNewAttempt}>
              Новая попытка
            </button>
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

        <aside className={`reference-panel ${rightOpen ? "is-open" : ""}`} aria-label="Материалы к вопросу">
          <div className="panel-mobile-head"><strong>Материалы</strong><button className="icon-button" onClick={() => setRightOpen(false)} aria-label="Закрыть материалы"><X size={18} /></button></div>
          <div className="reference-tabs" role="tablist">
            <button role="tab" aria-selected={rightTab === "sources"} onClick={() => setRightTab("sources")}>Источники</button>
            <button role="tab" aria-selected={rightTab === "reference"} onClick={() => setRightTab("reference")}>Эталон</button>
            <button role="tab" aria-selected={rightTab === "notes"} onClick={() => setRightTab("notes")}>Заметки</button>
          </div>
          <div className={`reference-content ${sourcePulse ? "source-pulse" : ""}`}>
            {rightTab === "sources" && (
              sourcesLocked ? (
                <div className="locked-state"><BookOpen size={24} /><h2>Материалы закрыты</h2><p>Источники откроются после завершения экзаменационного ответа.</p></div>
              ) : (
                <div>
                  <p className="eyebrow">Связанный фрагмент</p>
                  <h2>{exam.documents.find((document) => document.id === activeSource?.documentId)?.title}</h2>
                  <span className="source-page">Страница {activeSource?.page}</span>
                  {sourceText ? <p className="source-copy">{sourceText}</p> : <LoadingState label="Извлекаем страницу" />}
                </div>
              )
            )}
            {rightTab === "reference" && (
              referenceRevealed ? (
                <div className="reference-answer"><p className="eyebrow">Эталон пакета</p><h2>Опорный ответ</h2><p>{question.referenceAnswer}</p></div>
              ) : (
                <div className="locked-state"><MessageSquare size={24} /><h2>Сначала сформулируйте ответ</h2><p>Эталон скрыт, чтобы не подменять воспроизведение узнаванием.</p><button className="secondary-button" onClick={() => setReferenceRevealed(true)}>Показать эталон</button></div>
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
