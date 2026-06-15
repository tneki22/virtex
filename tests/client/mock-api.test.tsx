import { beforeEach, describe, expect, it } from "vitest";
import { MockExamApi } from "../../client/src/api.js";

describe("MockExamApi study chat persistence", () => {
  beforeEach(() => localStorage.clear());

  it("restores a tutor dialogue in a new API instance", async () => {
    const first = new MockExamApi(0);
    const chat = await first.createChat({
      examId: "mock-database",
      questionId: "q-1",
      kind: "tutor",
      profileId: "mentor",
    });
    await first.sendTutorMessage(chat.id, "Объясни на примере доставки пиццы");

    const restored = await new MockExamApi(0).getChat(chat.id);

    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0]?.content).toContain("доставки пиццы");
    expect(restored.title).toContain("Объясни");
  });

  it("preserves the review follow-up limit across API instances", async () => {
    const first = new MockExamApi(0);
    const chat = await first.createChat({
      examId: "mock-database",
      questionId: "q-1",
      kind: "review",
      profileId: "mentor",
    });
    expect((await first.reviewChat(chat.id, "Короткий ответ")).action).toBe("clarify");
    expect((await new MockExamApi(0).reviewChat(chat.id, "Ещё короче")).action).toBe("clarify");

    expect((await new MockExamApi(0).reviewChat(chat.id, "Третье уточнение")).action).toBe("final");
  });

  it("groups completed exams, keeps study attempts separate, and cancels active runs", async () => {
    const api = new MockExamApi(0);
    const study = await api.createSession({
      examId: "mock-database",
      questionId: "q-1",
      mode: "study",
      profileId: "mentor",
    });
    await api.review(study.id, "Достаточно длинный учебный ответ, который сразу получает итоговую оценку и сохраняется отдельно.");

    const completed = await api.createExamRun({
      examId: "mock-database",
      profileId: "mentor",
      questionCount: 1,
    });
    await api.review(completed.session!.id, "Достаточно длинный экзаменационный ответ, который сразу получает итоговую оценку.");

    const history = await api.getHistory();
    expect(history.examRuns).toHaveLength(1);
    expect(history.studyAttempts).toHaveLength(1);
    expect((await api.getExamHistory(completed.run.id)).items[0]).toMatchObject({
      answer: expect.stringContaining("экзаменационный"),
      review: { action: "final" },
    });

    const active = await api.createExamRun({
      examId: "mock-database",
      profileId: "mentor",
      questionCount: 2,
    });
    await api.cancelExamRun(active.run.id);
    await expect(api.getExamRun(active.run.id)).rejects.toThrow("Exam run not found");
    expect((await api.getHistory()).examRuns).toHaveLength(1);
  });
});
