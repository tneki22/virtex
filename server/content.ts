import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ExamPackage } from "../shared/contracts.js";
import { examPackageSchema } from "../shared/schemas.js";
import { compileExamPackage } from "../scripts/compiler.js";

export async function loadExamPackages(contentRoot: string): Promise<ExamPackage[]> {
  const entries = await readdir(contentRoot, { withFileTypes: true });
  const packages: ExamPackage[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const packageRoot = path.join(contentRoot, entry.name);
    const compiledPath = path.join(packageRoot, "compiled", "package.json");
    try {
      const serialized = await readFile(compiledPath, "utf8");
      packages.push(examPackageSchema.parse(JSON.parse(serialized)));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      packages.push(await compileExamPackage(packageRoot));
    }
  }

  return packages;
}
