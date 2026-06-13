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
});
