import type Database from "better-sqlite3";
import type {
  EditableExaminerProfile,
  ExamPackage,
  ExaminerProfile,
  RuntimePromptSettings,
  RuntimePromptSettingsUpdate,
  SystemPromptSet,
} from "../shared/contracts.js";
import { runtimePromptSettingsUpdateSchema } from "../shared/schemas.js";
import { defaultPersonaInstructions } from "./prompt.js";

interface PromptSettingsRow {
  value: string;
  updated_at: string;
}

interface RuntimePromptServiceOptions {
  database: Database.Database;
}

export function defaultSystemPromptsForProfile(profile: ExaminerProfile): SystemPromptSet {
  return {
    studyTutor: defaultPersonaInstructions(profile, "study_tutor"),
    studyReview: defaultPersonaInstructions(profile, "study_review"),
    examFinal: defaultPersonaInstructions(profile, "exam_final"),
    documentTutor: defaultPersonaInstructions(profile, "document_tutor"),
  };
}

export class RuntimePromptService {
  constructor(private readonly options: RuntimePromptServiceOptions) {}

  getSettings(exam: ExamPackage): RuntimePromptSettings {
    const stored = this.readStored(exam.id);
    const profiles = this.mergeProfiles(exam, stored.profiles);
    return {
      examId: exam.id,
      profiles,
      defaults: this.defaultProfiles(exam),
      ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
    };
  }

  activeProfiles(exam: ExamPackage): ExaminerProfile[] {
    return this
      .getSettings(exam)
      .profiles
      .filter((profile) => !profile.archived)
      .map(toExaminerProfile);
  }

  resolveProfile(exam: ExamPackage, profileId: string): ExaminerProfile | undefined {
    return this.mergeProfiles(exam, this.readStored(exam.id).profiles)
      .find((profile) => profile.id === profileId);
  }

  updateSettings(
    exam: ExamPackage,
    input: RuntimePromptSettingsUpdate,
  ): RuntimePromptSettings {
    const update = runtimePromptSettingsUpdateSchema.parse(input);
    this.writeStored(exam.id, update);
    return this.getSettings(exam);
  }

  resetProfile(exam: ExamPackage, profileId: string): RuntimePromptSettings {
    const defaults = new Map(this.defaultProfiles(exam).map((profile) => [profile.id, profile]));
    const replacement = defaults.get(profileId);
    const retained = this
      .mergeProfiles(exam, this.readStored(exam.id).profiles)
      .filter((profile) => profile.id !== profileId);
    const nextProfiles = replacement ? [replacement, ...retained] : retained;
    this.writeStored(exam.id, { profiles: nextProfiles });
    return this.getSettings(exam);
  }

  resetSettings(exam: ExamPackage): RuntimePromptSettings {
    this.options.database.prepare("DELETE FROM settings WHERE key = ?").run(settingKey(exam.id));
    return this.getSettings(exam);
  }

  private defaultProfiles(exam: ExamPackage): EditableExaminerProfile[] {
    return exam.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      tone: profile.tone,
      ...(profile.persona ? { persona: profile.persona } : {}),
      systemPrompts: defaultSystemPromptsForProfile(profile),
      quickPrompts: profile.quickPrompts ?? [],
    }));
  }

  private mergeProfiles(
    exam: ExamPackage,
    storedProfiles: EditableExaminerProfile[] | undefined,
  ): EditableExaminerProfile[] {
    if (!storedProfiles) return this.defaultProfiles(exam);

    const defaults = this.defaultProfiles(exam);
    const defaultIds = new Set(defaults.map((profile) => profile.id));
    const storedById = new Map(storedProfiles.map((profile) => [profile.id, profile]));
    const mergedDefaults = defaults.map((profile) => storedById.get(profile.id) ?? profile);
    const customProfiles = storedProfiles.filter((profile) => !defaultIds.has(profile.id));
    return [...mergedDefaults, ...customProfiles];
  }

  private readStored(examId: string): {
    profiles?: EditableExaminerProfile[];
    updatedAt?: string;
  } {
    const row = this.options.database
      .prepare("SELECT value, updated_at FROM settings WHERE key = ?")
      .get(settingKey(examId)) as PromptSettingsRow | undefined;
    if (!row) return {};

    try {
      const parsed = runtimePromptSettingsUpdateSchema.parse(JSON.parse(row.value));
      return { profiles: parsed.profiles, updatedAt: row.updated_at };
    } catch {
      return {};
    }
  }

  private writeStored(examId: string, update: RuntimePromptSettingsUpdate) {
    const parsed = runtimePromptSettingsUpdateSchema.parse(update);
    this.options.database.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(settingKey(examId), JSON.stringify(parsed), new Date().toISOString());
  }
}

function settingKey(examId: string) {
  return `prompts.${examId}`;
}

function toExaminerProfile(profile: EditableExaminerProfile): ExaminerProfile {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    tone: profile.tone,
    ...(profile.persona ? { persona: profile.persona } : {}),
    systemPrompts: profile.systemPrompts,
    quickPrompts: profile.quickPrompts,
    ...(profile.archived ? { archived: profile.archived } : {}),
  };
}
