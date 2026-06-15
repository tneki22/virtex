import type Database from "better-sqlite3";
import type {
  AIProviderId,
  RuntimeAISettings,
  RuntimeAISettingsUpdate,
  SpeechProviderId,
} from "../shared/contracts.js";
import { runtimeAISettingsUpdateSchema } from "../shared/schemas.js";
import { OpenAICompatibleProvider, type AIProvider } from "./ai.js";
import {
  GroqTranscriptionProvider,
  OpenRouterTranscriptionProvider,
  type SpeechTranscriptionProvider,
} from "./transcription.js";

export interface ProviderEnvironment {
  apiKey?: string;
  baseUrl: string;
  textModel: string;
  speechModel: string;
}

export interface RuntimeAIEnvironment {
  openrouter: ProviderEnvironment;
  groq: ProviderEnvironment;
}

interface ProviderConfig {
  provider: AIProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface RuntimeAIFactories {
  createTextProvider(config: ProviderConfig): AIProvider;
  createSpeechProvider(config: ProviderConfig): SpeechTranscriptionProvider;
}

interface RuntimeAISnapshot {
  state: RuntimeAISettings;
  textProvider: AIProvider | null;
  speechProvider: SpeechTranscriptionProvider | null;
}

const SETTING = {
  openrouterApiKey: "ai.openrouter.api_key",
  groqApiKey: "ai.groq.api_key",
  textProvider: "ai.text.provider",
  textModel: "ai.text.model",
  speechProvider: "ai.speech.provider",
  speechModel: "ai.speech.model",
} as const;

const defaultFactories: RuntimeAIFactories = {
  createTextProvider: (config) => new OpenAICompatibleProvider(config),
  createSpeechProvider: (config) => config.provider === "groq"
    ? new GroqTranscriptionProvider(config)
    : new OpenRouterTranscriptionProvider(config),
};

export class RuntimeAIService {
  private snapshot: RuntimeAISnapshot;
  private readonly factories: RuntimeAIFactories;

  constructor(private readonly options: {
    database: Database.Database;
    environment: RuntimeAIEnvironment;
    factories?: RuntimeAIFactories;
  }) {
    this.factories = options.factories ?? defaultFactories;
    this.snapshot = this.buildSnapshot();
  }

  getState(): RuntimeAISettings {
    return structuredClone(this.snapshot.state);
  }

  getTextProvider(): AIProvider | null {
    return this.snapshot.textProvider;
  }

  getSpeechProvider(): SpeechTranscriptionProvider | null {
    return this.snapshot.speechProvider;
  }

  update(input: RuntimeAISettingsUpdate): RuntimeAISettings {
    const update = runtimeAISettingsUpdateSchema.parse(input);
    const stored = this.readSettings();
    const openrouterOverride = update.clearOpenrouterApiKey
      ? undefined
      : update.openrouterApiKey ?? stored.get(SETTING.openrouterApiKey);
    const groqOverride = update.clearGroqApiKey
      ? undefined
      : update.groqApiKey ?? stored.get(SETTING.groqApiKey);
    const effectiveKeys = {
      openrouter: openrouterOverride ?? this.options.environment.openrouter.apiKey,
      groq: groqOverride ?? this.options.environment.groq.apiKey,
    };

    if (!effectiveKeys[update.textProvider]) {
      throw new Error(`${providerName(update.textProvider)} API key is required for text`);
    }
    if (update.speechProvider !== "disabled" && !effectiveKeys[update.speechProvider]) {
      throw new Error(`${providerName(update.speechProvider)} API key is required for speech`);
    }

    const write = this.options.database.transaction(() => {
      this.writeSetting(SETTING.textProvider, update.textProvider);
      this.writeSetting(SETTING.textModel, update.textModel);
      this.writeSetting(SETTING.speechProvider, update.speechProvider);
      this.writeSetting(SETTING.speechModel, update.speechModel);
      this.updateKey(SETTING.openrouterApiKey, update.openrouterApiKey, update.clearOpenrouterApiKey);
      this.updateKey(SETTING.groqApiKey, update.groqApiKey, update.clearGroqApiKey);
    });
    write();
    this.snapshot = this.buildSnapshot();
    return this.getState();
  }

  private readSettings(): Map<string, string> {
    const rows = this.options.database.prepare("SELECT key, value FROM settings").all() as Array<{
      key: string;
      value: string;
    }>;
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  private writeSetting(key: string, value: string) {
    this.options.database.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value, new Date().toISOString());
  }

  private updateKey(key: string, replacement?: string, clear?: boolean) {
    if (clear) {
      this.options.database.prepare("DELETE FROM settings WHERE key = ?").run(key);
    } else if (replacement) {
      this.writeSetting(key, replacement);
    }
  }

  private buildSnapshot(): RuntimeAISnapshot {
    const stored = this.readSettings();
    const keys = {
      openrouter: resolveKey(stored.get(SETTING.openrouterApiKey), this.options.environment.openrouter.apiKey),
      groq: resolveKey(stored.get(SETTING.groqApiKey), this.options.environment.groq.apiKey),
    };
    const textProvider = parseTextProvider(stored.get(SETTING.textProvider))
      ?? (keys.openrouter.value ? "openrouter" : keys.groq.value ? "groq" : "openrouter");
    const speechProvider = parseSpeechProvider(stored.get(SETTING.speechProvider))
      ?? (keys.groq.value ? "groq" : keys.openrouter.value ? "openrouter" : "disabled");
    const textModel = stored.get(SETTING.textModel)
      ?? this.options.environment[textProvider].textModel;
    const speechModel = speechProvider === "disabled"
      ? ""
      : stored.get(SETTING.speechModel) ?? this.options.environment[speechProvider].speechModel;
    const textKey = keys[textProvider].value;
    const speechKey = speechProvider === "disabled" ? undefined : keys[speechProvider].value;

    return {
      state: {
        keys: {
          openrouter: keyStatus(keys.openrouter),
          groq: keyStatus(keys.groq),
        },
        text: { provider: textProvider, model: textModel, available: Boolean(textKey) },
        speech: {
          provider: speechProvider,
          model: speechModel,
          available: speechProvider !== "disabled" && Boolean(speechKey),
        },
      },
      textProvider: textKey
        ? this.factories.createTextProvider({
            provider: textProvider,
            apiKey: textKey,
            baseUrl: this.options.environment[textProvider].baseUrl,
            model: textModel,
          })
        : null,
      speechProvider: speechProvider !== "disabled" && speechKey
        ? this.factories.createSpeechProvider({
            provider: speechProvider,
            apiKey: speechKey,
            baseUrl: this.options.environment[speechProvider].baseUrl,
            model: speechModel,
          })
        : null,
    };
  }
}

function resolveKey(application: string | undefined, environment: string | undefined) {
  if (application) return { value: application, source: "application" as const };
  if (environment) return { value: environment, source: "environment" as const };
  return { value: undefined, source: "missing" as const };
}

function keyStatus(key: ReturnType<typeof resolveKey>) {
  return { configured: Boolean(key.value), source: key.source };
}

function parseTextProvider(value: string | undefined): AIProviderId | undefined {
  return value === "openrouter" || value === "groq" ? value : undefined;
}

function parseSpeechProvider(value: string | undefined): SpeechProviderId | undefined {
  return value === "openrouter" || value === "groq" || value === "disabled" ? value : undefined;
}

function providerName(provider: AIProviderId) {
  return provider === "groq" ? "GroqCloud" : "OpenRouter";
}
