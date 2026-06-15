export function clearExamRunDrafts(examId: string, runId: string) {
  const prefix = `virtex:draft:${examId}:`;
  const suffix = `:${runId}`;
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix) && key.endsWith(suffix)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}
