import { Link } from "react-router-dom";
import type { ExamQuestion, ExamRunSummary as ExamRunSummaryData } from "../../../shared/contracts.js";

interface ExamRunSummaryProps {
  examId: string;
  summary: ExamRunSummaryData;
  questions: Array<Pick<ExamQuestion, "id" | "officialNumber" | "displayText">>;
}

export function ExamRunSummary({ examId, summary, questions }: ExamRunSummaryProps) {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const lowest = [...summary.results]
    .filter((item) => item.baseScore !== undefined)
    .sort((left, right) => (left.baseScore ?? 101) - (right.baseScore ?? 101))[0];

  return (
    <section className="exam-run-summary" aria-labelledby="exam-summary-title">
      <p className="eyebrow">Экзамен завершён</p>
      <h1 id="exam-summary-title">Результат серии</h1>
      <div className="summary-score">
        <strong>{summary.averageScore === undefined ? "—" : `${summary.averageScore}/100`}</strong>
      </div>
      <dl className="summary-metrics">
        <div><dt>Готов</dt><dd>{summary.ready}</dd></div>
        <div><dt>Почти готов</dt><dd>{summary.almostReady}</dd></div>
        <div><dt>Повторить</dt><dd>{summary.review}</dd></div>
        <div><dt>Опыт</dt><dd>{summary.totalXp} XP</dd></div>
      </dl>
      {summary.results.length > 0 && (
        <div className="summary-results">
          {summary.results.map((item) => {
            const question = questionMap.get(item.questionId);
            return (
              <div key={item.id}>
                <span>Вопрос {question?.officialNumber ?? item.position}</span>
                <strong>{item.baseScore === undefined ? "Без оценки" : `${item.baseScore}/100`}</strong>
              </div>
            );
          })}
        </div>
      )}
      <div className="summary-actions">
        <Link className="primary-button" to={`/exams/${examId}`}>Новый экзамен</Link>
        {lowest && (
          <Link className="secondary-button" to={`/exams/${examId}/workspace/${lowest.questionId}?mode=study`}>
            Изучить ошибки
          </Link>
        )}
      </div>
    </section>
  );
}
