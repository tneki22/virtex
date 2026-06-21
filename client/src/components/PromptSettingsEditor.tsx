import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  EditableExaminerProfile,
  RuntimePromptSettings,
  SystemPromptSet,
} from "../../../shared/contracts.js";
import type { ExamApi } from "../api.js";
import { AutoResizeTextarea } from "./AutoResizeTextarea.js";
import { AnimatedDisclosure, SegmentedTabs } from "./ui/index.js";

type PromptTab = keyof SystemPromptSet;

const promptTabs: Array<{ value: PromptTab; label: string }> = [
  { value: "studyTutor", label: "Разбор темы" },
  { value: "studyReview", label: "Проверка ответа" },
  { value: "examFinal", label: "Экзамен" },
  { value: "documentTutor", label: "Документ" },
];

const promptLabels: Record<PromptTab, string> = {
  studyTutor: "Системный промпт для разбора темы",
  studyReview: "Системный промпт для проверки ответа",
  examFinal: "Системный промпт для экзамена",
  documentTutor: "Системный промпт для чата по документу",
};

const fallbackSystemPrompts: SystemPromptSet = {
  studyTutor: "Разбирай тему как наставник.",
  studyReview: "Проверь ответ студента.",
  examFinal: "Проведи итоговую экзаменационную проверку.",
  documentTutor: "Отвечай по выбранному документу и показывай источники.",
};

export function PromptSettingsEditor({ api, examId }: { api: ExamApi; examId: string }) {
  const [settings, setSettings] = useState<RuntimePromptSettings | null>(null);
  const [profiles, setProfiles] = useState<EditableExaminerProfile[]>([]);
  const [activePromptTab, setActivePromptTab] = useState<PromptTab>("studyTutor");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.getPromptSettings(examId)
      .then((value) => {
        if (cancelled) return;
        const normalized = normalizePromptSettings(value);
        setSettings(normalized);
        setProfiles(normalized.profiles);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, examId]);

  const activeProfiles = useMemo(
    () => profiles.filter((profile) => !profile.archived),
    [profiles],
  );
  const valid = activeProfiles.length > 0 && activeProfiles.every(profileIsValid);

  function updateProfiles(next: EditableExaminerProfile[]) {
    setProfiles(next);
    setDirty(true);
    setSavedMessage("");
  }

  function updateProfile(
    profileId: string,
    updater: (profile: EditableExaminerProfile) => EditableExaminerProfile,
  ) {
    updateProfiles(profiles.map((profile) => (
      profile.id === profileId ? updater(profile) : profile
    )));
  }

  function duplicateProfile(profile: EditableExaminerProfile) {
    const nextId = uniqueId(profiles.map((item) => item.id), `${profile.id}-copy`);
    updateProfiles([
      ...profiles,
      {
        ...profile,
        id: nextId,
        name: `${profile.name} копия`.slice(0, 80),
        archived: false,
        quickPrompts: profile.quickPrompts.map((prompt) => ({ ...prompt })),
        systemPrompts: { ...profile.systemPrompts },
      },
    ]);
  }

  function resetProfile(profileId: string) {
    const replacement = settings?.defaults.find((profile) => profile.id === profileId);
    if (!replacement) return;
    updateProfiles(profiles.map((profile) => (
      profile.id === profileId ? structuredClone(replacement) : profile
    )));
  }

  function archiveProfile(profileId: string) {
    if (activeProfiles.length <= 1) return;
    updateProfile(profileId, (profile) => ({ ...profile, archived: true }));
  }

  function addProfile() {
    const base = settings?.defaults[0] ?? profiles[0];
    if (!base) return;
    const nextId = uniqueId(profiles.map((profile) => profile.id), "custom-profile");
    updateProfiles([
      ...profiles,
      {
        ...structuredClone(base),
        id: nextId,
        name: "Новая личность",
        description: "Пользовательская настройка поведения экзаменатора.",
        archived: false,
      },
    ]);
  }

  function addQuickPrompt(profileId: string) {
    updateProfile(profileId, (profile) => ({
      ...profile,
      quickPrompts: [
        ...profile.quickPrompts,
        {
          id: uniqueId(profile.quickPrompts.map((prompt) => prompt.id), "quick-prompt"),
          label: "",
          prompt: "",
        },
      ],
    }));
  }

  function updateQuickPrompt(
    profileId: string,
    promptId: string,
    key: "label" | "prompt",
    value: string,
  ) {
    updateProfile(profileId, (profile) => ({
      ...profile,
      quickPrompts: profile.quickPrompts.map((prompt) => (
        prompt.id === promptId ? { ...prompt, [key]: value } : prompt
      )),
    }));
  }

  function removeQuickPrompt(profileId: string, promptId: string) {
    updateProfile(profileId, (profile) => ({
      ...profile,
      quickPrompts: profile.quickPrompts.filter((prompt) => prompt.id !== promptId),
    }));
  }

  function moveQuickPrompt(profileId: string, promptId: string, direction: -1 | 1) {
    updateProfile(profileId, (profile) => {
      const index = profile.quickPrompts.findIndex((prompt) => prompt.id === promptId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= profile.quickPrompts.length) return profile;
      const next = [...profile.quickPrompts];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...profile, quickPrompts: next };
    });
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.updatePromptSettings(examId, { profiles });
      const normalized = normalizePromptSettings(saved);
      setSettings(normalized);
      setProfiles(normalized.profiles);
      setDirty(false);
      setSavedMessage("Промпты сохранены");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить промпты");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="prompt-settings-section" aria-labelledby="prompt-settings-heading">
      <div className="prompt-settings-heading">
        <div>
          <p className="eyebrow">Поведение чата</p>
          <h2 id="prompt-settings-heading">Промпты личностей</h2>
        </div>
        <div className="prompt-settings-actions">
          {dirty && <span className="prompt-dirty-indicator">Есть несохраненные изменения</span>}
          <button type="button" className="secondary-button" onClick={addProfile} disabled={!settings}>
            <Plus size={15} /> Добавить личность
          </button>
        </div>
      </div>

      {!settings && !error && <p className="prompt-settings-note">Загружаем настройки промптов...</p>}
      {error && <p className="prompt-settings-error" role="alert">{error}</p>}

      {settings && (
        <>
          <AnimatedDisclosure title="Личности" defaultOpen className="prompt-root-disclosure">
            <div className="prompt-profile-list">
              {activeProfiles.map((profile, index) => (
                <AnimatedDisclosure
                  key={profile.id}
                  title={<ProfileTitle profile={profile} />}
                  defaultOpen={index === 0}
                  className="prompt-profile-disclosure"
                >
                  <div className="prompt-profile-editor">
                    <div className="prompt-profile-grid">
                      <label>
                        Название личности
                        <input
                          value={profile.name}
                          maxLength={80}
                          onChange={(event) => updateProfile(profile.id, (current) => ({
                            ...current,
                            name: event.target.value,
                          }))}
                        />
                      </label>
                      <label>
                        Тон личности
                        <select
                          value={profile.tone}
                          onChange={(event) => updateProfile(profile.id, (current) => ({
                            ...current,
                            tone: event.target.value as EditableExaminerProfile["tone"],
                          }))}
                        >
                          <option value="supportive">Поддерживающий</option>
                          <option value="neutral">Нейтральный</option>
                          <option value="strict">Строгий</option>
                        </select>
                      </label>
                    </div>

                    <label>
                      Описание личности
                      <AutoResizeTextarea
                        value={profile.description}
                        maxLength={600}
                        onChange={(event) => updateProfile(profile.id, (current) => ({
                          ...current,
                          description: event.target.value,
                        }))}
                      />
                    </label>

                    <div className="prompt-mode-editor">
                      <SegmentedTabs
                        label="Режим системного промпта"
                        value={activePromptTab}
                        tabs={promptTabs}
                        onChange={setActivePromptTab}
                        className="prompt-mode-tabs"
                      />
                      <label>
                        {promptLabels[activePromptTab]}
                        <AutoResizeTextarea
                          value={profile.systemPrompts[activePromptTab]}
                          maxLength={12_000}
                          maxHeight={520}
                          onChange={(event) => updateProfile(profile.id, (current) => ({
                            ...current,
                            systemPrompts: {
                              ...current.systemPrompts,
                              [activePromptTab]: event.target.value,
                            },
                          }))}
                        />
                        <span className="prompt-counter">
                          {profile.systemPrompts[activePromptTab].length}/12000
                        </span>
                      </label>
                    </div>

                    <AnimatedDisclosure title="Быстрые промпты" defaultOpen className="quick-prompt-disclosure">
                      <div className="quick-prompt-editor-list">
                        {profile.quickPrompts.map((prompt, promptIndex) => (
                          <div className="quick-prompt-editor" key={prompt.id}>
                            <label>
                              Название быстрого промпта
                              <input
                                value={prompt.label}
                                maxLength={80}
                                onChange={(event) => updateQuickPrompt(
                                  profile.id,
                                  prompt.id,
                                  "label",
                                  event.target.value,
                                )}
                              />
                            </label>
                            <label>
                              Текст быстрого промпта
                              <AutoResizeTextarea
                                value={prompt.prompt}
                                maxLength={2_000}
                                onChange={(event) => updateQuickPrompt(
                                  profile.id,
                                  prompt.id,
                                  "prompt",
                                  event.target.value,
                                )}
                              />
                            </label>
                            <div className="quick-prompt-actions">
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Переместить быстрый промпт выше"
                                disabled={promptIndex === 0}
                                onClick={() => moveQuickPrompt(profile.id, prompt.id, -1)}
                              >
                                <ArrowUp size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Переместить быстрый промпт ниже"
                                disabled={promptIndex === profile.quickPrompts.length - 1}
                                onClick={() => moveQuickPrompt(profile.id, prompt.id, 1)}
                              >
                                <ArrowDown size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Удалить быстрый промпт"
                                onClick={() => removeQuickPrompt(profile.id, prompt.id)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => addQuickPrompt(profile.id)}
                        >
                          <Plus size={15} /> Добавить быстрый промпт
                        </button>
                      </div>
                    </AnimatedDisclosure>

                    <div className="prompt-profile-actions">
                      <button type="button" className="secondary-button" onClick={() => duplicateProfile(profile)}>
                        <Copy size={15} /> Дублировать личность
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!settings.defaults.some((item) => item.id === profile.id)}
                        onClick={() => resetProfile(profile.id)}
                      >
                        <RotateCcw size={15} /> Сбросить профиль
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={activeProfiles.length <= 1}
                        onClick={() => archiveProfile(profile.id)}
                      >
                        <Trash2 size={15} /> Удалить
                      </button>
                    </div>
                  </div>
                </AnimatedDisclosure>
              ))}
            </div>
          </AnimatedDisclosure>

          <div className="prompt-settings-footer">
            <div>
              {!valid && <p className="prompt-settings-error">Заполните название, описание, системные и быстрые промпты.</p>}
              {savedMessage && <p className="prompt-settings-success" role="status">{savedMessage}</p>}
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!valid || !dirty || saving}
              onClick={() => void save()}
            >
              <Save size={16} /> {saving ? "Сохраняем..." : "Сохранить промпты"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function normalizePromptSettings(settings: RuntimePromptSettings): RuntimePromptSettings {
  return {
    ...settings,
    profiles: settings.profiles.map(normalizeProfile),
    defaults: settings.defaults.map(normalizeProfile),
  };
}

function normalizeProfile(profile: EditableExaminerProfile): EditableExaminerProfile {
  return {
    ...profile,
    quickPrompts: profile.quickPrompts ?? [],
    systemPrompts: completeSystemPrompts(profile.systemPrompts as Partial<SystemPromptSet> | undefined),
  };
}

function completeSystemPrompts(prompts: Partial<SystemPromptSet> | undefined): SystemPromptSet {
  return {
    ...fallbackSystemPrompts,
    ...prompts,
  };
}

function ProfileTitle({ profile }: { profile: EditableExaminerProfile }) {
  return (
    <span className="prompt-profile-title">
      <strong>{profile.name || "Без названия"}</strong>
      <small>{profile.quickPrompts.length} быстрых</small>
    </span>
  );
}

function profileIsValid(profile: EditableExaminerProfile) {
  const prompts = completeSystemPrompts(profile.systemPrompts as Partial<SystemPromptSet> | undefined);
  return Boolean(
    profile.name.trim() &&
    profile.description.trim() &&
    prompts.studyTutor.trim() &&
    prompts.studyReview.trim() &&
    prompts.examFinal.trim() &&
    prompts.documentTutor.trim() &&
    profile.quickPrompts.every((prompt) => prompt.label.trim() && prompt.prompt.trim()),
  );
}

function uniqueId(existingIds: string[], seed: string) {
  const used = new Set(existingIds);
  let counter = 1;
  let candidate = seed;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${seed}-${counter}`;
  }
  return candidate;
}
