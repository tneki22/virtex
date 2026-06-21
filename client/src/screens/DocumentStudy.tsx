import {
  ArrowLeft,
  BookOpen,
  Database,
  FileText,
  History,
  Mic,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Square,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  DocumentStudyDocument,
  RetrievedSourceReference,
  SessionMessage,
  StudyChatDetail,
  StudyChatSummary,
  StreamingPreference,
} from "../../../shared/contracts.js";
import type { ExamApi, ExamDetail } from "../api.js";
import { api as defaultApi } from "../api.js";
import { ErrorState, LoadingState } from "../components/AppShell.js";
import { ExaminerProfilePicker } from "../components/ExaminerProfilePicker.js";
import { MarkdownMessage } from "../components/MarkdownMessage.js";
import { PanelResizeHandle } from "../components/PanelResizeHandle.js";
import { useVoiceInput } from "../hooks/useVoiceInput.js";

type DocumentChatMessage = SessionMessage & { streaming?: boolean };
type DocumentStudyChatDetail = Omit<StudyChatDetail, "messages"> & {
  messages: DocumentChatMessage[];
};

export function DocumentStudy({ api = defaultApi }: { api?: ExamApi }) {
  const { examId = "" } = useParams();
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentStudyDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [chats, setChats] = useState<StudyChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<DocumentStudyChatDetail | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingPreference, setStreamingPreference] = useState<StreamingPreference>("auto");
  const trailRef = useRef<HTMLDivElement>(null);
  const documentLayout = useDocumentStudyLayout();
  const voiceQuestionId = exam?.questions[0]?.id ?? "";
  const voiceInput = useVoiceInput({
    api,
    questionId: voiceQuestionId,
    onTranscript: (text) => setMessage((current) => current.trim()
      ? `${current.trimEnd()}\n\n${text}`
      : text),
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.getExam(examId),
      api.listDocumentStudyDocuments(examId),
      api.getAISettings().catch(() => null),
    ]).then(([loadedExam, loadedDocuments, aiSettings]) => {
      if (cancelled) return;
      setExam(loadedExam);
      setProfileId(loadedExam.profiles[0]?.id ?? "");
      setDocuments(loadedDocuments);
      setSelectedDocumentId(
        loadedDocuments.find((document) => document.indexStatus.state === "ready")?.id
          ?? loadedDocuments[0]?.id
          ?? "",
      );
      if (aiSettings) setStreamingPreference(aiSettings.text.streamingPreference);
    }).catch((reason: Error) => setError(reason.message));
    return () => { cancelled = true; };
  }, [api, examId]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  useEffect(() => {
    if (!selectedDocumentId) return;
    let cancelled = false;
    setActiveChat(null);
    void api.listDocumentChats(examId, selectedDocumentId)
      .then(async (history) => {
        if (cancelled) return;
        setChats(history);
        if (history[0]) {
          const detail = await api.getChat(history[0].id);
          if (!cancelled) setActiveChat(detail);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => { cancelled = true; };
  }, [api, examId, selectedDocumentId]);

  const lastMessage = activeChat?.messages.at(-1);
  useLayoutEffect(() => {
    const trail = trailRef.current;
    if (!trail) return;
    const scrollToBottom = () => {
      trail.scrollTop = trail.scrollHeight;
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [activeChat?.id, activeChat?.messages.length, lastMessage?.content]);

  async function prepareIndex() {
    if (!selectedDocument) return;
    setBusy(true);
    setError("");
    try {
      const indexStatus = await api.prepareDocumentIndex(examId, selectedDocument.id);
      setDocuments((current) => current.map((document) => document.id === selectedDocument.id
        ? { ...document, indexStatus }
        : document));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить поиск по документу");
    } finally {
      setBusy(false);
    }
  }

  async function createChat() {
    if (!selectedDocument || !profileId) return;
    setBusy(true);
    setError("");
    try {
      const chat = await api.createDocumentChat({
        examId,
        documentId: selectedDocument.id,
        profileId,
      });
      setChats((current) => [{ ...chat, messageCount: 0 }, ...current]);
      setActiveChat(chat);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document chat could not be created");
    } finally {
      setBusy(false);
    }
  }

  async function openChat(chatId: string) {
    setBusy(true);
    setError("");
    try {
      setActiveChat(await api.getChat(chatId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document chat could not be opened");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (!activeChat || !message.trim() || busy) return;
    const content = message.trim();
    const chatId = activeChat.id;
    const useStreaming = streamingPreference !== "off";
    const pendingUserId = crypto.randomUUID();
    const pendingAssistantId = crypto.randomUUID();
    setMessage("");
    setBusy(true);
    setError("");
    const pendingUser: DocumentChatMessage = {
      id: pendingUserId,
      sessionId: chatId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const pendingAssistant: DocumentChatMessage = {
      id: pendingAssistantId,
      sessionId: chatId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
    };
    setActiveChat((current) => current?.id === chatId ? {
      ...current,
      messages: [
        ...current.messages,
        pendingUser,
        ...(useStreaming ? [pendingAssistant] : []),
      ],
    } : current);
    try {
      const turn = await api.sendTutorMessage(chatId, content, {
        stream: useStreaming,
        onDelta: useStreaming
          ? (delta) => {
              setActiveChat((current) => current?.id === chatId ? {
                ...current,
                messages: current.messages.map((item) => item.id === pendingAssistantId
                  ? { ...item, content: item.content + delta, streaming: true }
                  : item),
              } : current);
            }
          : undefined,
      });
      setActiveChat((current) => current?.id === chatId ? {
        ...current,
        title: turn.title,
        updatedAt: turn.updatedAt,
        messages: [
          ...current.messages.filter((item) => (
            item.id !== pendingUserId && item.id !== pendingAssistantId
          )),
          turn.user,
          turn.assistant,
        ],
      } : current);
      setChats((current) => current.map((chat) => chat.id === chatId
        ? {
            ...chat,
            title: turn.title,
            updatedAt: turn.updatedAt,
            latestMessage: turn.assistant.content,
            messageCount: chat.messageCount + 2,
          }
        : chat).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    } catch (reason) {
      setActiveChat((current) => current?.id === chatId ? {
        ...current,
        messages: current.messages.filter((item) => (
          item.id !== pendingUserId && item.id !== pendingAssistantId
        )),
      } : current);
      setMessage((current) => current || content);
      setError(reason instanceof Error ? reason.message : "Message could not be sent");
    } finally {
      setBusy(false);
    }
  }

  if (!exam) {
    return (
      <main className="document-study-page">
        {error ? <ErrorState message={error} /> : <LoadingState label="Загружаем чат по документу" />}
      </main>
    );
  }

  const indexReady = selectedDocument?.indexStatus.state === "ready";
  const indexUnavailable = selectedDocument?.indexStatus.state === "unavailable";

  return (
    <main
      className="document-study-page"
      style={{
        "--document-sidebar": `${documentLayout.layout.sidebar}px`,
        "--document-history": `${documentLayout.layout.history}px`,
      } as CSSProperties}
    >
      <aside className="document-study-sidebar" aria-label="Документы">
        <Link className="document-study-back" to={`/exams/${exam.id}`}><ArrowLeft size={16} /> Назад</Link>
        <div>
          <p className="eyebrow">{exam.title}</p>
          <h1>Изучение 2</h1>
        </div>
        <div className="document-list" role="list" aria-label="Документы для поиска">
          {documents.map((document) => (
            <button
              key={document.id}
              className={document.id === selectedDocumentId ? "is-active" : ""}
              onClick={() => setSelectedDocumentId(document.id)}
            >
              <FileText size={18} />
              <span>
                <strong>{document.title}</strong>
                <small>{formatDocumentMeta(document)}</small>
              </span>
              <em>{formatIndexState(document.indexStatus.state)}</em>
            </button>
          ))}
        </div>
      </aside>
      <PanelResizeHandle
        label="Изменить ширину списка документов"
        value={documentLayout.layout.sidebar}
        min={MIN_DOCUMENT_SIDEBAR}
        max={documentLayout.limits.sidebarMax}
        onChange={(value) => documentLayout.setPanel("sidebar", value)}
        onPointerStart={(event) => documentLayout.startResize("sidebar", event)}
        onReset={documentLayout.reset}
      />

      <section className="document-study-main" aria-label="Чат по документу">
        {selectedDocument ? (
          <>
            <header className="document-study-header">
              <div>
                <p className="eyebrow">Выбранный документ</p>
                <h2>{selectedDocument.title}</h2>
                {selectedDocument.indexStatus.message && (
                  <p className="document-index-note">{selectedDocument.indexStatus.message}</p>
                )}
              </div>
              <div className="document-study-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={selectedDocument.indexStatus.state === "ready" ? "Обновить поиск по документу" : "Подготовить поиск по документу"}
                  disabled={busy || indexUnavailable}
                  onClick={() => void prepareIndex()}
                >
                  {selectedDocument.indexStatus.state === "ready" ? <RefreshCw size={15} /> : <Database size={15} />}
                  {selectedDocument.indexStatus.state === "ready" ? "Обновить поиск" : "Подготовить поиск"}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  aria-label="Новый чат по документу"
                  disabled={busy || !indexReady}
                  onClick={() => void createChat()}
                >
                  <MessageSquarePlus size={16} /> Новый чат по документу
                </button>
              </div>
            </header>

            <div className="document-study-grid">
              <aside className="document-chat-history" aria-label="История чатов по документу">
                <ExaminerProfilePicker profiles={exam.profiles} value={profileId} onChange={setProfileId} />
                <div className="document-history-list">
                  <div className="document-history-title"><History size={15} /> История</div>
                  {chats.map((chat) => (
                    <button key={chat.id} className={chat.id === activeChat?.id ? "is-active" : ""} onClick={() => void openChat(chat.id)}>
                      <strong>{chat.title}</strong>
                      <small>{formatMessageCount(chat.messageCount)}</small>
                    </button>
                  ))}
                </div>
              </aside>
              <PanelResizeHandle
                label="Изменить ширину истории чатов"
                value={documentLayout.layout.history}
                min={MIN_DOCUMENT_HISTORY}
                max={documentLayout.limits.historyMax}
                onChange={(value) => documentLayout.setPanel("history", value)}
                onPointerStart={(event) => documentLayout.startResize("history", event)}
                onReset={documentLayout.reset}
              />

              <div className="document-chat-panel">
                {!activeChat && (
                  <div className="document-chat-empty">
                    <BookOpen size={28} />
                    <p>{indexUnavailable
                      ? "Настройте модель поиска перед подготовкой документа."
                      : indexReady
                        ? "Создайте чат и задайте вопрос по выбранному источнику."
                        : "Перед началом чата подготовьте поиск по документу."}</p>
                  </div>
                )}
                {activeChat && (
                  <>
                    <div ref={trailRef} className="document-dialogue" role="log" aria-label="Диалог по документу">
                      {activeChat.messages.map((item) => (
                        <article key={item.id} className={`document-message role-${item.role}`}>
                          <strong>{item.role === "user" ? "Вы" : "Наставник"}</strong>
                          {item.streaming && !item.content
                            ? <span className="typing-indicator" aria-label="Наставник печатает"><span /><span /><span /></span>
                            : <MarkdownMessage text={item.content} />}
                          {item.sources && item.sources.length > 0 && <SourceList sources={item.sources} />}
                        </article>
                      ))}
                    </div>
                    <div className="document-message-editor">
                      <textarea
                        aria-label="Сообщение"
                        value={message}
                        rows={2}
                        onChange={(event) => setMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void sendMessage();
                        }}
                      />
                      <div className="document-editor-controls">
                        <button
                          type="button"
                          className={`voice-button ${voiceInput.status === "recording" ? "is-recording" : ""}`}
                          disabled={!voiceQuestionId || busy || voiceInput.status === "transcribing"}
                          onClick={() => void voiceInput.toggle()}
                        >
                          {voiceInput.status === "recording" ? <Square size={14} /> : <Mic size={15} />}
                          {voiceInput.status === "recording"
                            ? `Стоп ${Math.floor(voiceInput.durationSeconds / 60)}:${String(voiceInput.durationSeconds % 60).padStart(2, "0")}`
                            : voiceInput.status === "transcribing" ? "Распознаём…" : "Диктовать"}
                        </button>
                        {voiceInput.error && <span className="voice-error">{voiceInput.error}</span>}
                        <button type="button" className="primary-button" aria-label="Отправить сообщение" disabled={busy || !message.trim()} onClick={() => void sendMessage()}>
                          {busy ? <><span className="button-spinner" /> Отправляем</> : <><Send size={16} /> Отправить</>}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <ErrorState message="Для этого экзамена не настроены документы для поиска." />
        )}
        {error && <ErrorState message={error} />}
      </section>
    </main>
  );
}

function formatDocumentMeta(document: DocumentStudyDocument) {
  if (document.pageCount) return `${document.pageCount} стр.`;
  return document.role ?? "document";
}

function formatIndexState(state: DocumentStudyDocument["indexStatus"]["state"]) {
  if (state === "ready") return "готов";
  if (state === "stale") return "устарел";
  if (state === "unavailable") return "недоступен";
  return "не создан";
}

function formatMessageCount(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} сообщение`;
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} сообщения`;
  return `${count} сообщений`;
}

function SourceList({ sources }: { sources: RetrievedSourceReference[] }) {
  const pages = uniqueSourcePages(sources);
  if (pages.length === 0) return null;
  return (
    <ul className="document-source-list" aria-label="Страницы источников">
      {pages.map((page) => (
        <li key={page}>
          <span>Стр. {page}</span>
        </li>
      ))}
    </ul>
  );
}

function uniqueSourcePages(sources: RetrievedSourceReference[]) {
  const seen = new Set<number>();
  const pages: number[] = [];
  for (const source of sources) {
    if (seen.has(source.page)) continue;
    seen.add(source.page);
    pages.push(source.page);
  }
  return pages;
}

type DocumentStudyPanel = "sidebar" | "history";

interface DocumentStudyLayout {
  sidebar: number;
  history: number;
}

const DOCUMENT_STUDY_LAYOUT_KEY = "virtex:document-study-layout";
const DEFAULT_DOCUMENT_STUDY_LAYOUT: DocumentStudyLayout = { sidebar: 300, history: 280 };
const MIN_DOCUMENT_SIDEBAR = 240;
const MIN_DOCUMENT_HISTORY = 220;
const MIN_DOCUMENT_CHAT = 420;
const MAX_DOCUMENT_SIDEBAR = 420;
const MAX_DOCUMENT_HISTORY = 380;
const DOCUMENT_STUDY_HANDLE_SPACE = 24;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function parseStoredDocumentStudyLayout(value: string | null, width: number): DocumentStudyLayout {
  if (!value) return clampDocumentStudyLayout(DEFAULT_DOCUMENT_STUDY_LAYOUT, width);
  try {
    const parsed = JSON.parse(value) as Partial<DocumentStudyLayout>;
    if (!Number.isFinite(parsed.sidebar) || !Number.isFinite(parsed.history)) {
      return clampDocumentStudyLayout(DEFAULT_DOCUMENT_STUDY_LAYOUT, width);
    }
    return clampDocumentStudyLayout({
      sidebar: parsed.sidebar as number,
      history: parsed.history as number,
    }, width);
  } catch {
    return clampDocumentStudyLayout(DEFAULT_DOCUMENT_STUDY_LAYOUT, width);
  }
}

function clampDocumentStudyLayout(layout: DocumentStudyLayout, width: number): DocumentStudyLayout {
  const sidebarHardMax = Math.min(MAX_DOCUMENT_SIDEBAR, Math.floor(width * 0.4));
  let sidebar = clamp(layout.sidebar, MIN_DOCUMENT_SIDEBAR, sidebarHardMax);
  const historyHardMax = Math.min(MAX_DOCUMENT_HISTORY, Math.floor(width * 0.34));
  const historySpaceMax = width - sidebar - MIN_DOCUMENT_CHAT - DOCUMENT_STUDY_HANDLE_SPACE;
  let history = clamp(layout.history, MIN_DOCUMENT_HISTORY, Math.min(historyHardMax, historySpaceMax));
  const sidebarSpaceMax = width - history - MIN_DOCUMENT_CHAT - DOCUMENT_STUDY_HANDLE_SPACE;
  sidebar = clamp(sidebar, MIN_DOCUMENT_SIDEBAR, Math.min(sidebarHardMax, sidebarSpaceMax));
  history = clamp(history, MIN_DOCUMENT_HISTORY, Math.min(historyHardMax, width - sidebar - MIN_DOCUMENT_CHAT - DOCUMENT_STUDY_HANDLE_SPACE));
  return { sidebar, history };
}

function documentStudyLayoutLimits(layout: DocumentStudyLayout, width: number) {
  const sidebarMax = Math.max(
    MIN_DOCUMENT_SIDEBAR,
    Math.min(
      MAX_DOCUMENT_SIDEBAR,
      Math.floor(width * 0.4),
      width - layout.history - MIN_DOCUMENT_CHAT - DOCUMENT_STUDY_HANDLE_SPACE,
    ),
  );
  const historyMax = Math.max(
    MIN_DOCUMENT_HISTORY,
    Math.min(
      MAX_DOCUMENT_HISTORY,
      Math.floor(width * 0.34),
      width - layout.sidebar - MIN_DOCUMENT_CHAT - DOCUMENT_STUDY_HANDLE_SPACE,
    ),
  );
  return { sidebarMax, historyMax };
}

function useDocumentStudyLayout() {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [layout, setLayout] = useState<DocumentStudyLayout>(() =>
    parseStoredDocumentStudyLayout(localStorage.getItem(DOCUMENT_STUDY_LAYOUT_KEY), window.innerWidth),
  );

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setLayout((current) => clampDocumentStudyLayout(current, window.innerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem(DOCUMENT_STUDY_LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  const limits = useMemo(() => documentStudyLayoutLimits(layout, viewportWidth), [layout, viewportWidth]);

  function setPanel(panel: DocumentStudyPanel, value: number) {
    setLayout((current) => clampDocumentStudyLayout({ ...current, [panel]: value }, window.innerWidth));
  }

  function startResize(panel: DocumentStudyPanel, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startLayout = layout;
    const handleMove = (moveEvent: PointerEvent) => {
      setPanel(panel, startLayout[panel] + moveEvent.clientX - startX);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("is-resizing-panels");
    };
    document.body.classList.add("is-resizing-panels");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  return {
    layout,
    limits,
    setPanel,
    startResize,
    reset: () => setLayout(clampDocumentStudyLayout(DEFAULT_DOCUMENT_STUDY_LAYOUT, window.innerWidth)),
  };
}
