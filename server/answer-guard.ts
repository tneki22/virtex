import type { AIReview, ExamQuestion } from "../shared/contracts.js";

type GuardedReview = Pick<
  AIReview,
  | "action"
  | "examinerMessage"
  | "baseScore"
  | "personaVerdict"
  | "strengths"
  | "gaps"
  | "errors"
  | "citations"
  | "advice"
>;

const instructionPattern =
  /\b(ignore|disregard|override|system prompt|new instruction|score me|give me)\b|игнорир|инструкц|системн(?:ая|ые|ый)?\s+(?:команд|инструкц)|поставь\s+\d+|дай\s+\d+\s*балл|оцени\s+на\s+\d+/iu;

const stopWords = new Set([
  "вопрос",
  "ответ",
  "свойство",
  "свойства",
  "основные",
  "описать",
  "опишите",
  "такое",
  "является",
  "которые",
  "question",
  "answer",
  "explain",
  "define",
]);

function subjectTerms(question: ExamQuestion): string[] {
  return [question.displayText, question.officialText, ...question.emphasis]
    .join(" ")
    .toLocaleLowerCase("ru")
    .match(/[\p{L}\p{N}-]{5,}/gu)
    ?.filter((term) => !stopWords.has(term)) ?? [];
}

export function guardInstructionOnlyAnswer(
  answer: string,
  question: ExamQuestion,
): GuardedReview | null {
  if (!instructionPattern.test(answer)) return null;

  const normalizedAnswer = answer.toLocaleLowerCase("ru");
  const hasSubjectContent = subjectTerms(question).some((term) =>
    normalizedAnswer.includes(term.slice(0, Math.min(7, term.length))),
  );
  if (hasSubjectContent) return null;

  return {
    action: "final",
    examinerMessage:
      "В сообщении нет содержательного ответа на экзаменационный вопрос. Мета-инструкции не учитываются при проверке.",
    baseScore: 0,
    personaVerdict: "Ответ по теме отсутствует.",
    strengths: [],
    gaps: ["Нужно дать определение и раскрыть ключевые положения вопроса."],
    errors: ["В сообщении нет ответа по теме; оно состоит из инструкций проверяющей системе."],
    citations: [],
    advice: "Удалите мета-инструкции и сформулируйте ответ по существу своими словами.",
  };
}
