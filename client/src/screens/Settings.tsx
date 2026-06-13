import { CheckCircle2, Cpu, Database, KeyRound, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExamApi } from "../api.js";
import { api as defaultApi } from "../api.js";
import { AppShell } from "../components/AppShell.js";

export function Settings({ api = defaultApi }: { api?: ExamApi }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; model?: string; message?: string } | null>(null);
  const [status, setStatus] = useState<{ aiConfigured: boolean; speechConfigured: boolean } | null>(null);

  useEffect(() => {
    void api.getSettingsStatus().then(setStatus).catch(() => setStatus(null));
  }, [api]);

  async function testConnection() {
    setTesting(true);
    try {
      setResult(await api.testAI());
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Ошибка соединения" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AppShell>
      <main className="page settings-page">
        <section className="page-intro compact">
          <p className="eyebrow">Конфигурация среды</p>
          <h1>Настройки</h1>
          <p className="lead">Ключ API хранится только в окружении сервера и никогда не передаётся клиенту.</p>
        </section>
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-icon"><Cpu size={21} /></div>
            <div><p className="eyebrow">AI-провайдер</p><h2>OpenAI-совместимый API</h2></div>
            <div className="env-list">
              <code>OPENAI_API_KEY</code><span>обязательный ключ</span>
              <code>OPENAI_BASE_URL</code><span>необязательный endpoint</span>
              <code>OPENAI_MODEL</code><span>модель проверки</span>
            </div>
            <p className={`provider-status ${status === null ? "pending" : status.aiConfigured ? "ok" : "failed"}`}>
              {status === null ? "Проверяем конфигурацию…" : status.aiConfigured ? "AI-проверка настроена" : "AI-проверка не настроена"}
            </p>
            <button className="primary-button" onClick={() => void testConnection()} disabled={testing}><KeyRound size={17} /> {testing ? "Проверяем" : "Проверить соединение"}</button>
            {result && <div className={`connection-result ${result.ok ? "ok" : "failed"}`}>{result.ok ? <CheckCircle2 size={18} /> : <KeyRound size={18} />}<span>{result.ok ? `Подключено: ${result.model}` : result.message}</span></div>}
          </section>
          <section className="settings-card">
            <div className="settings-card-icon"><Mic size={21} /></div>
            <div><p className="eyebrow">Голосовой ввод</p><h2>Groq Whisper</h2></div>
            <p>Аудио отправляется в Groq только после явного запуска записи. Файл не сохраняется в локальной базе, а распознанный текст остаётся редактируемым.</p>
            <div className="env-list">
              <code>GROQ_API_KEY</code><span>ключ транскрипции</span>
              <code>GROQ_WHISPER_MODEL</code><span>модель распознавания</span>
            </div>
            <p className={`provider-status ${status === null ? "pending" : status.speechConfigured ? "ok" : "failed"}`}>
              {status === null ? "Проверяем конфигурацию…" : status.speechConfigured ? "Голосовой ввод настроен" : "Голосовой ввод не настроен"}
            </p>
          </section>
          <section className="settings-card">
            <div className="settings-card-icon"><Database size={21} /></div>
            <div><p className="eyebrow">Хранение</p><h2>Локальная SQLite</h2></div>
            <p>Попытки, заметки, закладки, сообщения и результаты проверки сохраняются в <code>runtime/virtex.sqlite</code>.</p>
            <dl className="settings-facts"><div><dt>Аккаунты</dt><dd>Не используются</dd></div><div><dt>Синхронизация</dt><dd>Выключена</dd></div><div><dt>Тема</dt><dd>Системная</dd></div></dl>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
