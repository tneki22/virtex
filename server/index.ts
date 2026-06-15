import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { loadEnvironmentFiles, resolveRuntimeConfig } from "./config.js";
import { loadExamPackages } from "./content.js";
import { createDatabase } from "./database.js";
import { RuntimeAIService } from "./runtime-ai.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvironmentFiles(root);
const config = resolveRuntimeConfig(root, process.env);
await mkdir(path.dirname(config.databasePath), { recursive: true });

const exams = await loadExamPackages(path.join(root, "content", "exams"));
const database = createDatabase(config.databasePath);
const runtimeAI = new RuntimeAIService({
  database,
  environment: config.aiEnvironment,
});

const app = createApp({ database, exams, runtimeAI });
const clientDirectory = path.join(root, "dist", "client");
try {
  await access(clientDirectory);
  app.use(express.static(clientDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
    response.sendFile(path.join(clientDirectory, "index.html"));
  });
} catch {
  // Vite serves the client during development.
}

app.listen(config.port, "127.0.0.1", () => {
  const aiState = runtimeAI.getState();
  console.log(
    `Virtex API listening on http://127.0.0.1:${config.port} (${exams.length} exam package${exams.length === 1 ? "" : "s"}, AI ${aiState.text.available ? `on: ${aiState.text.provider}/${aiState.text.model}` : "off"}, speech ${aiState.speech.available ? `on: ${aiState.speech.provider}/${aiState.speech.model}` : "off"})`,
  );
});
