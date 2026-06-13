import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { OpenAICompatibleProvider } from "./ai.js";
import { loadEnvironmentFiles, resolveRuntimeConfig } from "./config.js";
import { loadExamPackages } from "./content.js";
import { createDatabase } from "./database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvironmentFiles(root);
const config = resolveRuntimeConfig(root, process.env);
await mkdir(path.dirname(config.databasePath), { recursive: true });

const exams = await loadExamPackages(path.join(root, "content", "exams"));
const database = createDatabase(config.databasePath);
const aiProvider = config.ai
  ? new OpenAICompatibleProvider({
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
    })
  : null;

const app = createApp({ database, exams, aiProvider });
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
  console.log(
    `Virtex API listening on http://127.0.0.1:${config.port} (${exams.length} exam package${exams.length === 1 ? "" : "s"}, AI ${aiProvider ? `on: ${aiProvider.model}` : "off"})`,
  );
});
