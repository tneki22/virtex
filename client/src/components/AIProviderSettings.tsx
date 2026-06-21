import { CheckCircle2, KeyRound, Mic, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AIConnectionTestResult,
  AIProviderId,
  RuntimeAISettings,
  RuntimeAISettingsUpdate,
  SpeechProviderId,
  StreamingPreference,
} from "../../../shared/contracts.js";
import type { ExamApi } from "../api.js";

interface SettingsForm {
  textProvider: AIProviderId;
  textModel: string;
  textStreamingPreference: StreamingPreference;
  speechProvider: SpeechProviderId;
  speechModel: string;
  openrouterApiKey: string;
  groqApiKey: string;
  clearOpenrouterApiKey: boolean;
  clearGroqApiKey: boolean;
}

const providerNames = { openrouter: "OpenRouter", groq: "GroqCloud" } as const;

export function AIProviderSettings({ api }: { api: ExamApi }) {
  const [settings, setSettings] = useState<RuntimeAISettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [textTest, setTextTest] = useState<AIConnectionTestResult | null>(null);
  const [speechTest, setSpeechTest] = useState<(AIConnectionTestResult & { text?: string }) | null>(null);
  const [speechSample, setSpeechSample] = useState<File | null>(null);

  useEffect(() => {
    void api.getAISettings().then((value) => {
      setSettings(value);
      setForm(formFromSettings(value));
    }).catch((reason: Error) => setError(reason.message));
  }, [api]);

  function change<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const update: RuntimeAISettingsUpdate = {
      textProvider: form.textProvider,
      textModel: form.textModel.trim(),
      textStreamingPreference: form.textStreamingPreference,
      speechProvider: form.speechProvider,
      speechModel: form.speechProvider === "disabled" ? "" : form.speechModel.trim(),
      ...(form.openrouterApiKey.trim() ? { openrouterApiKey: form.openrouterApiKey.trim() } : {}),
      ...(form.groqApiKey.trim() ? { groqApiKey: form.groqApiKey.trim() } : {}),
      ...(form.clearOpenrouterApiKey ? { clearOpenrouterApiKey: true } : {}),
      ...(form.clearGroqApiKey ? { clearGroqApiKey: true } : {}),
    };
    try {
      const value = await api.updateAISettings(update);
      setSettings(value);
      setForm(formFromSettings(value));
      setTextTest(null);
      setSpeechTest(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function testText() {
    setError("");
    setTextTest(null);
    try {
      setTextTest(await api.testAIText());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить текстовую модель");
    }
  }

  async function testSpeech() {
    if (!speechSample) return;
    setError("");
    setSpeechTest(null);
    try {
      setSpeechTest(await api.testAISpeech(speechSample));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось проверить распознавание");
    }
  }

  if (!settings || !form) {
    return (
      <section className="ai-settings-section" aria-labelledby="ai-settings-heading" aria-busy="true">
        <p role="status">Загружаем AI-настройки...</p>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="ai-settings-section" aria-labelledby="ai-settings-heading" aria-busy={saving}>
      <div className="ai-settings-heading">
        <div>
          <p className="eyebrow">Локальная конфигурация</p>
          <h2 id="ai-settings-heading">AI-провайдеры</h2>
        </div>
        <div className="ai-active-summary" aria-label="Активная конфигурация">
          <span>Текст: {providerNames[settings.text.provider]} · {settings.text.model}</span>
          <span>Streaming: {settings.text.streamingPreference === "off" ? "off" : settings.text.streamingAvailable ? "on" : "fallback"}</span>
          <span>Речь: {settings.speech.provider === "disabled" ? "выключена" : `${providerNames[settings.speech.provider]} · ${settings.speech.model}`}</span>
        </div>
      </div>

      <div className="ai-key-grid">
        <ProviderKeyCard
          name="OpenRouter"
          status={`OpenRouter: ${keyStatus(settings.keys.openrouter.source)}`}
          inputLabel="Новый ключ OpenRouter"
          value={form.openrouterApiKey}
          clearSelected={form.clearOpenrouterApiKey}
          onChange={(value) => {
            change("openrouterApiKey", value);
            if (value) change("clearOpenrouterApiKey", false);
          }}
          onUseEnvironment={() => {
            change("openrouterApiKey", "");
            change("clearOpenrouterApiKey", true);
          }}
        />
        <ProviderKeyCard
          name="GroqCloud"
          status={`GroqCloud: ${keyStatus(settings.keys.groq.source)}`}
          inputLabel="Новый ключ GroqCloud"
          value={form.groqApiKey}
          clearSelected={form.clearGroqApiKey}
          onChange={(value) => {
            change("groqApiKey", value);
            if (value) change("clearGroqApiKey", false);
          }}
          onUseEnvironment={() => {
            change("groqApiKey", "");
            change("clearGroqApiKey", true);
          }}
        />
      </div>

      <div className="ai-task-grid">
        <div className="ai-task-card">
          <div className="ai-task-title"><KeyRound size={18} /><strong>Диалоги и проверка</strong></div>
          <label>Провайдер текста
            <select value={form.textProvider} onChange={(event) => change("textProvider", event.target.value as AIProviderId)}>
              <option value="openrouter">OpenRouter</option>
              <option value="groq">GroqCloud</option>
            </select>
          </label>
          <label>Модель текста
            <input value={form.textModel} onChange={(event) => change("textModel", event.target.value)} />
          </label>
          <label>Streaming чата
            <select
              value={form.textStreamingPreference}
              onChange={(event) => change("textStreamingPreference", event.target.value as StreamingPreference)}
            >
              <option value="auto">Auto</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={() => void testText()}>
            <RefreshCw size={15} /> Проверить текст
          </button>
          {textTest && <TestResult result={textTest} />}
        </div>

        <div className="ai-task-card">
          <div className="ai-task-title"><Mic size={18} /><strong>Распознавание речи</strong></div>
          <label>Провайдер речи
            <select value={form.speechProvider} onChange={(event) => change("speechProvider", event.target.value as SpeechProviderId)}>
              <option value="groq">GroqCloud</option>
              <option value="openrouter">OpenRouter</option>
              <option value="disabled">Выключено</option>
            </select>
          </label>
          <label>Модель речи
            <input
              value={form.speechModel}
              disabled={form.speechProvider === "disabled"}
              onChange={(event) => change("speechModel", event.target.value)}
            />
          </label>
          <label className="ai-file-input">Аудиофайл для проверки речи
            <input type="file" accept="audio/*" onChange={(event) => setSpeechSample(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="secondary-button" disabled={!speechSample || form.speechProvider === "disabled"} onClick={() => void testSpeech()}>
            <RefreshCw size={15} /> Проверить речь
          </button>
          {speechTest && <TestResult result={speechTest} />}
        </div>
      </div>

      {error && <p className="ai-settings-error" role="alert">{error}</p>}
      <button type="button" className="primary-button ai-settings-save" disabled={saving} onClick={() => void save()}>
        <CheckCircle2 size={17} /> {saving ? "Сохраняем..." : "Сохранить AI-настройки"}
      </button>
      <p className="ai-settings-note">Ключи сохраняются только в локальной SQLite и не возвращаются браузеру. Пустое поле сохраняет текущий ключ.</p>
    </section>
  );
}

function ProviderKeyCard(props: {
  name: string;
  status: string;
  inputLabel: string;
  value: string;
  clearSelected: boolean;
  onChange(value: string): void;
  onUseEnvironment(): void;
}) {
  return (
    <div className="ai-key-card">
      <div><strong>{props.name}</strong><span>{props.status}</span></div>
      <label>{props.inputLabel}
        <input type="password" autoComplete="off" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      </label>
      <button type="button" className="text-button" onClick={props.onUseEnvironment}>
        {props.clearSelected ? "Будет использован ключ окружения" : "Использовать ключ окружения"}
      </button>
    </div>
  );
}

function TestResult({ result }: { result: AIConnectionTestResult }) {
  return <p role="status" aria-live="polite" className={`connection-result ${result.ok ? "ok" : "failed"}`}>{result.ok ? "Подключено" : result.message}: {result.provider} · {result.model}</p>;
}

function formFromSettings(settings: RuntimeAISettings): SettingsForm {
  return {
    textProvider: settings.text.provider,
    textModel: settings.text.model,
    textStreamingPreference: settings.text.streamingPreference ?? "auto",
    speechProvider: settings.speech.provider,
    speechModel: settings.speech.model,
    openrouterApiKey: "",
    groqApiKey: "",
    clearOpenrouterApiKey: false,
    clearGroqApiKey: false,
  };
}

function keyStatus(source: RuntimeAISettings["keys"]["openrouter"]["source"]) {
  if (source === "application") return "ключ из приложения";
  if (source === "environment") return "ключ из окружения";
  return "ключ не задан";
}
