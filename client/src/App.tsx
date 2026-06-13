import { Navigate, Route, Routes } from "react-router-dom";
import { ExamOverview } from "./screens/ExamOverview.js";
import { History } from "./screens/History.js";
import { Settings } from "./screens/Settings.js";
import { Workspace } from "./screens/Workspace.js";

export function App() {
  const defaultExamId = import.meta.env.VITE_USE_MOCKS === "true"
    ? "mock-database"
    : "database-fundamentals";

  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/exams/${defaultExamId}`} replace />} />
      <Route path="/exams/:examId" element={<ExamOverview />} />
      <Route path="/exams/:examId/workspace/:questionId" element={<Workspace />} />
      <Route path="/history" element={<History />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
