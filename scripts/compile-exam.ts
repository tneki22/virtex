import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileExamPackage } from "./compiler.js";

const packageRoot = process.argv[2];
if (!packageRoot) {
  throw new Error("Usage: tsx scripts/compile-exam.ts <package-directory> [--check]");
}

const compiled = await compileExamPackage(packageRoot);

if (!process.argv.includes("--check")) {
  const outputDirectory = path.join(packageRoot, "compiled");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "package.json"),
    `${JSON.stringify(compiled, null, 2)}\n`,
  );
}

console.log(
  `Validated ${compiled.title}: ${compiled.questions.length} questions, ${compiled.documents.length} documents`,
);
