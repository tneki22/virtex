import { Navigate, Route, Routes } from "react-router-dom";
import { ExamLibrary } from "./screens/ExamLibrary.js";
import { ExamOverview } from "./screens/ExamOverview.js";
import { History } from "./screens/History.js";
import { Settings } from "./screens/Settings.js";
import { Workspace } from "./screens/Workspace.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ExamLibrary />} />
      <Route path="/exams/:examId" element={<ExamOverview />} />
      <Route path="/exams/:examId/workspace/:questionId" element={<Workspace />} />
      <Route path="/history" element={<History />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
