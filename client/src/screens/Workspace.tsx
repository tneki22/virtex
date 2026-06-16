import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  History,
  BookOpen,
  Home,
  LogOut,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ExamQuestionCount,
  ExamRun,
  ExamRunSummary as ExamRunSummaryData,
  SessionKind,
  StudyChatDetail,
  StudyChatSummary,
  StudySession,
} from "../../../shared/contracts.js";
import { assertExamQuestionCount } from "../../../shared/exam-run.js";
import { readinessFromScore } from "../../../shared/progress.js";
import { normalizeStudyMode } from "../../../shared/study-mode.js";
import type { ExamApi, ExamDetail, QuestionDetail, ReviewResponse } from "../api.js";
import { api as defaultApi } from "../api.js";
import { ErrorState, LoadingState } from "../components/AppShell.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ExaminerProfilePicker } from "../components/ExaminerProfilePicker.js";
import { ExamRunSummary } from "../components/ExamRunSummary.js";
import { MarkdownMessage } from "../components/MarkdownMessage.js";
import { PanelResizeHandle } from "../components/PanelResizeHandle.js";
import { MIN_LEFT, MIN_RIGHT, usePanelLayout } from "../hooks/usePanelLayout.js";
import { useVoiceInput } from "../hooks/useVoiceInput.js";
import { clearExamRunDrafts } from "../exam-drafts.js";

type RightTab = "answers" | "notes";
type DialogueTurn = {
  id: string;
  role: "student" | "examiner";
  text: string;
};

const readinessLabels = {
  not_started: "Не начат",
  review: "Повторить",
  almost_ready: "Почти готов",
  ready: "Готов",
};

function formatTopicCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const label = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "тем"
    : lastDigit === 1
      ? "тема"
      : lastDigit >= 2 && lastDigit <= 4
        ? "темы"
        : "тем";
  return `${count} ${label}`;
}

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
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const answerTextarea = useRef<HTMLTextAreaElement>(null);
  const dialogueTrail = useRef<HTMLDivElement>(null);
  const preserveQuestionWhileLoading = useRef(false);
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
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [cancellingRun, setCancellingRun] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [chatHistory, setChatHistory] = useState<StudyChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<StudyChatDetail | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatKind, setNewChatKind] = useState<Exclude<SessionKind, "exam"> | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
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
    if (preserveQuestionWhileLoading.current) {
      preserveQuestionWhileLoading.current = false;
    } else {
      setQuestion(null);
    }
    setReview(null);
    setDialogueTurns([]);
    setCompleted(false);
    setActiveChat(null);
    setChatHistory([]);
    setNewChatOpen(false);
    setNewChatKind(null);
    void api
      .getQuestion(examId, selectedQuestionId)
      .then((loadedQuestion) => {
        setQuestion(loadedQuestion);
        setNote(loadedQuestion.note);
        if (mode === "exam") {
          const draftKey = `virtex:draft:${examId}:${loadedQuestion.id}:${runId ?? mode}`;
          setAnswer(localStorage.getItem(draftKey) ?? "");
        } else {
          setAnswer("");
        }
      })
      .catch((reason: Error) => setError(reason.message));
  }, [api, examId, mode, runId, selectedQuestionId]);

  useEffect(() => {
    if (mode !== "study" || !question) return;
    let cancelled = false;
    setLoadingChat(true);
    void api.listChats(examId, question.id)
      .then(async (history) => {
        if (cancelled) return;
        setChatHistory(history);
        if (history.length === 0) return;
        const detail = await api.getChat(history[0].id);
        if (!cancelled) restoreChat(detail);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false);
      });
    return () => { cancelled = true; };
  }, [api, examId, mode, question?.id]);

  const answersLocked = mode === "exam" && !completed;

  const draftKey = question
    ? `virtex:draft:${examId}:${question.id}:${mode === "study" ? activeChat?.id ?? "new" : runId ?? mode}`
    : "";

  useEffect(() => {
    if (!draftKey) return;
    localStorage.setItem(draftKey, answer);
  }, [answer, draftKey]);

  useEffect(() => {
    const textarea = answerTextarea.current;
    if (!textarea) return;
    if (mode !== "study") {
      textarea.style.height = "";
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [answer, mode, activeChat?.id]);

  useLayoutEffect(() => {
    const trail = dialogueTrail.current;
    if (!trail || mode !== "study") return;
    const scrollToBottom = () => {
      trail.scrollTop = trail.scrollHeight;
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [dialogueTurns.length, mode, activeChat?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "[" && mode === "study") setLeftOpen((value) => !value);
      if (event.key === "]") setRightOpen((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode]);

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
  const topicCount = useMemo(
    () => new Set(filteredQuestions.map((item) => item.groupTitle)).size,
    [filteredQuestions],
  );
  const currentQuestionIndex = useMemo(
    () => exam?.questions.findIndex((item) => item.id === question?.id) ?? -1,
    [exam, question?.id],
  );

  useEffect(() => {
    if (!rightFullscreen) return;
    const closeFullscreen = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRightFullscreen(false);
    };
    window.addEventListener("keydown", closeFullscreen);
    return () => window.removeEventListener("keydown", closeFullscreen);
  }, [rightFullscreen]);

  useEffect(() => {
    const expandForNarrowViewport = () => {
      if (window.innerWidth <= 1100) setLeftCollapsed(false);
    };
    window.addEventListener("resize", expandForNarrowViewport);
    return () => window.removeEventListener("resize", expandForNarrowViewport);
  }, []);

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

  function restoreChat(chat: StudyChatDetail) {
    setActiveChat(chat);
    setProfileId(chat.profileId);
    setSession(null);
    setDialogueTurns(chat.messages.map((message) => ({
      id: message.id,
      role: message.role === "user" ? "student" : "examiner",
      text: message.content,
    })));
    const latestReview = chat.reviews.at(-1);
    setReview(latestReview ? { ...latestReview, xp: 0 } : null);
    setCompleted(chat.status === "completed");
    const key = `virtex:draft:${examId}:${chat.questionId}:${chat.id}`;
    setAnswer(chat.status === "completed" ? "" : localStorage.getItem(key) ?? "");
    setChatHistoryOpen(false);
    setNewChatOpen(false);
    setNewChatKind(null);
  }

  async function openChat(chatId: string) {
    setLoadingChat(true);
    setError("");
    try {
      restoreChat(await api.getChat(chatId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть чат");
    } finally {
      setLoadingChat(false);
    }
  }

  async function createStudyChat() {
    if (!question || !newChatKind || !profileId || loadingChat) return;
    setLoadingChat(true);
    setError("");
    try {
      const chat = await api.createChat({
        examId,
        questionId: question.id,
        kind: newChatKind,
        profileId,
      });
      setChatHistory((history) => [{ ...chat, messageCount: 0 }, ...history]);
      restoreChat(chat);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать чат");
    } finally {
      setLoadingChat(false);
    }
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
      if (mode === "study" && !activeChat) throw new Error("Сначала создайте чат");
      if (mode === "study" && activeChat?.kind === "tutor") {
        const turn = await api.sendTutorMessage(activeChat.id, submittedAnswer);
        setDialogueTurns((turns) => [
          ...turns,
          { id: turn.assistant.id, role: "examiner", text: turn.assistant.content },
        ]);
        setActiveChat({
          ...activeChat,
          title: turn.title,
          updatedAt: turn.updatedAt,
          messages: [...activeChat.messages, turn.user, turn.assistant],
        });
        setChatHistory((history) => history.map((item) => item.id === activeChat.id
          ? { ...item, title: turn.title, updatedAt: turn.updatedAt, latestMessage: turn.assistant.content, messageCount: item.messageCount + 2 }
          : item).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setAnswer("");
        localStorage.removeItem(draftKey);
        return;
      }
      const currentSession = mode === "study" ? activeChat! : await ensureSession();
      const result = mode === "study"
        ? await api.reviewChat(currentSession.id, submittedAnswer)
        : await api.review(currentSession.id, submittedAnswer);
      setReview(result);
      setDialogueTurns((turns) => [
        ...turns,
        { id: crypto.randomUUID(), role: "examiner", text: result.examinerMessage },
      ]);
      if (activeChat && mode === "study") {
        const now = new Date().toISOString();
        const defaultTitle = "Проверка ответа";
        const normalized = submittedAnswer.replace(/\s+/g, " ").trim();
        const title = activeChat.title === defaultTitle
          ? normalized.length <= 64 ? normalized : `${normalized.slice(0, 61).trimEnd()}…`
          : activeChat.title;
        const chatStatus: StudySession["status"] = result.action === "final" ? "completed" : "active";
        const userMessage = {
          id: submittedTurn.id,
          sessionId: activeChat.id,
          role: "user" as const,
          content: submittedAnswer,
          createdAt: now,
        };
        const assistantMessage = {
          id: crypto.randomUUID(),
          sessionId: activeChat.id,
          role: "assistant" as const,
          content: result.examinerMessage,
          createdAt: now,
        };
        setActiveChat({
          ...activeChat,
          title,
          updatedAt: now,
          followUpCount: activeChat.followUpCount + (result.action === "clarify" ? 1 : 0),
          status: chatStatus,
          ...(result.action === "final" ? { completedAt: now } : {}),
          messages: [...activeChat.messages, userMessage, assistantMessage],
          reviews: [...activeChat.reviews, result],
        });
        setChatHistory((history) => history.map((item) => item.id === activeChat.id
          ? {
              ...item,
              title,
              updatedAt: now,
              status: chatStatus,
              followUpCount: item.followUpCount + (result.action === "clarify" ? 1 : 0),
              latestMessage: result.examinerMessage,
              latestReview: result,
              messageCount: item.messageCount + 2,
              ...(result.action === "final" ? { completedAt: now } : {}),
            }
          : item).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      }
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
        localStorage.removeItem(draftKey);
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

  function selectAdjacentQuestion(offset: -1 | 1) {
    const target = exam?.questions[currentQuestionIndex + offset];
    if (!target || mode !== "study") return;
    preserveQuestionWhileLoading.current = true;
    selectQuestion(target.id);
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

  async function cancelActiveExam() {
    if (!examRun || cancellingRun) return;
    setCancellingRun(true);
    setCancelError("");
    try {
      await api.cancelExamRun(examRun.id);
      clearExamRunDrafts(examId, examRun.id);
      navigate(`/exams/${examId}`, { replace: true });
    } catch (reason) {
      setCancelError(reason instanceof Error ? reason.message : "Не удалось прервать экзамен");
    } finally {
      setCancellingRun(false);
    }
  }

  if (error && !exam) return <ErrorState message={error} />;
  if (!exam) return <LoadingState label="Открываем рабочее пространство" />;
  if (mode === "exam" && routeQuestionId === "random") {
    return (
      <div className="workspace-page exam-setup-page">
        <Link to={`/exams/${exam.id}`} className="workspace-home-corner" aria-label="В меню"><Home size={18} /></Link>
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
        <Link to={`/exams/${exam.id}`} className="workspace-home-corner" aria-label="В меню"><Home size={18} /></Link>
        <main><ExamRunSummary examId={exam.id} summary={examSummary} questions={exam.questions} /></main>
      </div>
    );
  }
  if (!question) return <LoadingState label="Открываем рабочее пространство" />;
  const activeProfile = exam.profiles.find((profile) => profile.id === (activeChat?.profileId ?? profileId));

  return (
    <div className="workspace-page">
      {mode === "exam" && examRun?.status === "active" && (
        <button className="exam-exit-button" onClick={() => { setCancelError(""); setExitDialogOpen(true); }}>
          <LogOut size={16} /> Выйти
        </button>
      )}
      <div
        className={`workspace-grid ${mode === "exam" ? "workspace-grid-exam" : ""} ${leftCollapsed ? "is-left-collapsed" : ""}`}
        style={{
          "--left-panel": `${panelLayout.layout.left}px`,
          "--right-panel": `${panelLayout.layout.right}px`,
        } as CSSProperties}
      >
        {mode === "study" && <aside id="question-panel" className={`question-panel ${leftOpen ? "is-open" : ""} ${leftCollapsed ? "is-collapsed" : ""}`} aria-label="Навигация по вопросам">
          {leftCollapsed ? (
            <div className="collapsed-panel-actions">
              <Link to={`/exams/${exam.id}`} className="icon-button" aria-label="В меню"><Home size={18} /></Link>
              <button className="icon-button" onClick={() => setLeftCollapsed(false)} aria-label="Развернуть список вопросов"><PanelLeftOpen size={18} /></button>
            </div>
          ) : (
            <>
              <div className="panel-mobile-head"><strong>Вопросы</strong><button className="icon-button" onClick={() => setLeftOpen(false)} aria-label="Закрыть список"><X size={18} /></button></div>
              <div className="question-panel-toolbar">
                <Link to={`/exams/${exam.id}`} className="icon-button" aria-label="В меню"><Home size={17} /></Link>
                <div className="question-search">
                  <Search size={16} />
                  <input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер или тема" aria-label="Поиск вопросов" />
                  <kbd>/</kbd>
                </div>
                <button className="icon-button desktop-panel-control" onClick={() => setLeftCollapsed(true)} aria-label="Свернуть список вопросов"><PanelLeftClose size={17} /></button>
              </div>
              <div className="question-panel-caption">
                <span>{filteredQuestions.length} вопросов</span>
                <span>{formatTopicCount(topicCount)}</span>
              </div>
              <div className="question-list">
                {filteredQuestions.map((item) => (
                  <button
                    key={item.id}
                    className={`question-list-item ${item.id === question.id ? "is-active" : ""}`}
                    onClick={() => selectQuestion(item.id)}
                    aria-label={`${item.officialNumber}. ${item.displayText}`}
                  >
                    <span className="question-number">{String(item.officialNumber).padStart(2, "0")}</span>
                    <span className="question-list-copy"><strong>{item.displayText}</strong><small>{item.groupTitle.replace(/^Модуль [A-ZА-Я]:\s*/u, "")}</small></span>
                    <span className="question-state" />
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>}

        {mode === "study" && <PanelResizeHandle
          label="Изменить ширину списка вопросов"
          value={panelLayout.layout.left}
          min={MIN_LEFT}
          max={panelLayout.limits.leftMax}
          onChange={(value) => panelLayout.setSide("left", value)}
          onPointerStart={(event) => panelLayout.startResize("left", event)}
          onReset={panelLayout.reset}
        />}

        <main className="answer-panel">
          <div className="workspace-mobile-tools tablet-only">
            {mode === "study" && <Link to={`/exams/${exam.id}`} className="icon-button" aria-label="В меню"><Home size={18} /></Link>}
            {mode === "study" && <button className="icon-button" onClick={() => setLeftOpen(true)} aria-label="Открыть список вопросов" aria-controls="question-panel" aria-expanded={leftOpen}><Menu size={19} /></button>}
            <button className="icon-button" onClick={() => setRightOpen(true)} aria-label="Открыть ответы и заметки" aria-controls="reference-panel" aria-expanded={rightOpen || rightFullscreen}><PanelRightOpen size={19} /></button>
          </div>
          <div className="question-heading-row">
            <div>
              <p className="eyebrow">Вопрос {question.officialNumber} · {question.groupTitle}</p>
              <h1>{question.displayText}</h1>
              {question.officialText !== question.displayText && (
                <details className="official-wording"><summary>Официальная формулировка</summary><p>{question.officialText}</p></details>
              )}
            </div>
            <button className="icon-button bookmark-button" onClick={() => void toggleBookmark()} aria-label={question.bookmarked ? "Убрать из закладок" : "Добавить в закладки"} aria-pressed={question.bookmarked}>
              {question.bookmarked ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
            </button>
          </div>

          {mode === "study" ? (
            <div className="readiness-strip">
              <span className={`readiness-dot ${question.progress.readiness}`} />
              {readinessLabels[question.progress.readiness]}
              {question.progress.bestScore !== undefined && <strong>{question.progress.bestScore}/100</strong>}
              <span>{question.progress.attempts} попыток</span>
            </div>
          ) : (
            <div className="exam-question-progress">Вопрос {examRun?.currentPosition ?? 1} из {examRun?.questionCount ?? 1}</div>
          )}

          {mode === "study" && (
            <section className="chat-controls" aria-label="Управление чатами">
              <div className="chat-current">
                <span className={`chat-kind kind-${activeChat?.kind ?? "empty"}`}>
                  {activeChat?.kind === "tutor" ? "Разбор темы" : activeChat?.kind === "review" ? "Проверка ответа" : "Чат не выбран"}
                </span>
                <strong title={activeChat?.title}>{activeChat?.title ?? "Создайте чат для работы с вопросом"}</strong>
                {activeProfile && activeChat && <span className="chat-profile">{activeProfile.name}</span>}
              </div>
              <div className="chat-actions">
                <button
                  className="secondary-button"
                  disabled={chatHistory.length === 0}
                  aria-expanded={chatHistoryOpen}
                  aria-controls="chat-history-popover"
                  onClick={() => setChatHistoryOpen((value) => !value)}
                ><History size={15} /> История</button>
                <button className="primary-button" onClick={() => { setNewChatOpen(true); setNewChatKind(null); setChatHistoryOpen(false); }}><Plus size={15} /> Новый чат</button>
              </div>
              {chatHistoryOpen && (
                <div id="chat-history-popover" className="chat-history-popover" role="region" aria-label="История чатов">
                  {chatHistory.map((chat) => (
                    <button key={chat.id} className={chat.id === activeChat?.id ? "is-active" : ""} onClick={() => void openChat(chat.id)}>
                      <span>{chat.kind === "tutor" ? "Разбор" : "Оценка"}</span>
                      <strong>{chat.title}</strong>
                      <small>{chat.messageCount} сообщений</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {mode === "study" && newChatOpen && (
            <section className="new-chat-card" aria-label="Создание чата">
              <p className="eyebrow">Новый чат</p>
              {!newChatKind ? (
                <div className="chat-kind-options">
                  <button onClick={() => setNewChatKind("tutor")}><BookOpen size={20} /><strong>Разобрать тему</strong><span>Свободный диалог, примеры и объяснения</span></button>
                  <button onClick={() => setNewChatKind("review")}><ClipboardCheck size={20} /><strong>Проверить ответ</strong><span>Уточнения и итоговая оценка</span></button>
                </div>
              ) : (
                <>
                  <ExaminerProfilePicker profiles={exam.profiles} value={profileId} onChange={setProfileId} />
                  <div className="new-chat-actions">
                    <button className="secondary-button" onClick={() => setNewChatKind(null)}>Назад</button>
                    <button className="primary-button" disabled={loadingChat} onClick={() => void createStudyChat()}>Создать чат</button>
                  </div>
                </>
              )}
            </section>
          )}

          {mode === "study" && activeChat?.kind === "tutor" && (activeProfile?.quickPrompts?.length ?? 0) > 0 && (
            <div className="quick-prompts" aria-label="Быстрые промпты">
              {activeProfile!.quickPrompts!.map((prompt) => (
                <button key={prompt.id} onClick={() => setAnswer(prompt.prompt)}>{prompt.label}</button>
              ))}
            </div>
          )}

          {mode === "study" && !activeChat && !newChatOpen && !loadingChat && (
            <div className="chat-empty-state"><MessageSquare size={22} /><p>Создайте чат для разбора темы или проверки ответа.</p></div>
          )}

          {(mode === "exam" || activeChat) && <section className="answer-editor-section">
            <div className="editor-label"><span>{activeChat?.kind === "tutor" ? "Сообщение" : review?.action === "clarify" ? "Ваше уточнение" : "Ваш ответ"}</span><small>{completed ? "Чат завершён" : "Черновик сохраняется локально"}</small></div>
            {dialogueTurns.length > 0 && (
              <div ref={dialogueTrail} className="dialogue-trail" role="region" aria-label="Предыдущие реплики">
                {dialogueTurns.map((turn) => (
                  <div className={`dialogue-turn role-${turn.role}`} key={turn.id}>
                    <strong>{turn.role === "student" ? "Вы" : "Экзаменатор"}</strong>
                    <MarkdownMessage text={turn.text} />
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={answerTextarea}
              className={mode === "study" ? "chat-answer-input" : undefined}
              value={answer}
              disabled={completed}
              rows={mode === "study" ? 1 : undefined}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submitAnswer();
              }}
              placeholder={mode === "study" ? "Сформулируйте ответ своими словами…" : "Отвечайте так, как говорили бы на экзамене…"}
              aria-label={mode === "study" ? "Сообщение чата" : "Ответ на вопрос"}
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
                {loadingReview ? <><span className="button-spinner" /> Отправляем</> : <><Send size={17} /> {activeChat?.kind === "tutor" ? "Отправить сообщение" : review?.action === "clarify" ? "Ответить на уточнение" : "Проверить ответ"}</>}
              </button>
            </div>
          </section>}

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
              {(review.challengeQuestions?.length ?? 0) > 0 && (
                <div className="review-challenge-questions staged-line">
                  <h3>Вопросы на подумать</h3>
                  {review.challengeQuestions!.map((item) => <p key={item}>{item}</p>)}
                </div>
              )}
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
          {mode === "exam" && completed && !examRun && (
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

        <aside id="reference-panel" className={`reference-panel ${rightOpen ? "is-open" : ""} ${rightFullscreen ? "is-fullscreen" : ""}`} aria-label="Ответы и заметки">
          <div className="panel-mobile-head"><strong>Ответы и заметки</strong><button className="icon-button" onClick={() => { setRightOpen(false); setRightFullscreen(false); }} aria-label="Закрыть панель"><X size={18} /></button></div>
          <div className="reference-toolbar">
            <div className="reference-tabs" role="tablist">
              <button id="answers-tab" role="tab" aria-controls="reference-tabpanel" aria-selected={rightTab === "answers"} tabIndex={rightTab === "answers" ? 0 : -1} disabled={answersLocked} onClick={() => setRightTab("answers")}>Ответы</button>
              <button id="notes-tab" role="tab" aria-controls="reference-tabpanel" aria-selected={rightTab === "notes"} tabIndex={rightTab === "notes" ? 0 : -1} onClick={() => setRightTab("notes")}>Заметки</button>
            </div>
            {rightFullscreen && mode === "study" && (
              <nav className="reference-question-navigation" aria-label="Навигация между вопросами">
                <button
                  className="icon-button"
                  disabled={currentQuestionIndex <= 0}
                  onClick={() => selectAdjacentQuestion(-1)}
                  aria-label="Предыдущий вопрос"
                >
                  <ChevronLeft size={18} />
                </button>
                <span>{currentQuestionIndex + 1} из {exam.questions.length}</span>
                <button
                  className="icon-button"
                  disabled={currentQuestionIndex < 0 || currentQuestionIndex >= exam.questions.length - 1}
                  onClick={() => selectAdjacentQuestion(1)}
                  aria-label="Следующий вопрос"
                >
                  <ChevronRight size={18} />
                </button>
              </nav>
            )}
            <button
              className="icon-button reference-expand-button"
              onClick={() => { setRightFullscreen((value) => !value); setRightOpen(false); }}
              aria-label={rightFullscreen ? "Вернуть документ в панель" : "Развернуть документ на весь экран"}
              aria-pressed={rightFullscreen}
            >
              {rightFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </div>
          <div id="reference-tabpanel" className="reference-content" role="tabpanel" aria-labelledby={rightTab === "answers" ? "answers-tab" : "notes-tab"}>
            {rightTab === "answers" && (
              answersLocked ? (
                <div className="locked-state"><MessageSquare size={24} /><h2>Ответы закрыты</h2><p>Эталон станет доступен после итоговой проверки текущего вопроса.</p></div>
              ) : (
                <div className="reference-answer">
                  <h2>{question.displayText}</h2>
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
      {!rightFullscreen && ((mode === "study" && leftOpen) || rightOpen) && <button className="panel-backdrop tablet-only" aria-label="Закрыть панель" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
      {exitDialogOpen && (
        <ConfirmDialog
          title="Прервать экзамен?"
          description="Текущая серия, ответы и черновики будут удалены без возможности восстановления."
          cancelLabel="Остаться"
          confirmLabel="Прервать экзамен"
          error={cancelError}
          busy={cancellingRun}
          onCancel={() => setExitDialogOpen(false)}
          onConfirm={() => void cancelActiveExam()}
        />
      )}
    </div>
  );
}
