import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileExamPackage } from "../../scripts/compiler.js";

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "virtex-exam-"));
  await mkdir(path.join(root, "documents"));
  await writeFile(
    path.join(root, "documents", "guide.md"),
    "# Transactions\n\nA transaction is a logical unit of database work.",
  );
  await writeFile(path.join(root, "style-guide.md"), "Answer precisely and cite sources.");
  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify({
      id: "database-test",
      version: "1.0.0",
      title: "Database test",
      description: "A fixture exam",
      subject: "Databases",
      profiles: [
        {
          id: "neutral",
          name: "Neutral",
          description: "Checks substance",
          tone: "neutral",
        },
      ],
      documents: [
        {
          id: "guide",
          title: "Guide",
          type: "markdown",
          path: "documents/guide.md",
        },
      ],
      thresholds: { almostReady: 60, ready: 80 },
      policy: {
        timerMinutes: null,
        maxFollowUps: 2,
        referenceReveal: "after_attempt_or_explicit",
      },
    }),
  );

  return root;
}

describe("compileExamPackage", () => {
  it("creates stable fragments and resolves question sources", async () => {
    const root = await createFixture();
    await writeFile(
      path.join(root, "questions.json"),
      JSON.stringify([
        {
          id: "q-01",
          officialNumber: 1,
          officialText: "Define a transaction",
          displayText: "What is a transaction?",
          groupId: "core",
          groupTitle: "Core concepts",
          referenceAnswer: "A transaction is a logical unit of database work.",
          emphasis: ["logical unit"],
          sources: [
            {
              documentId: "guide",
              page: 1,
              quote: "logical unit of database work",
            },
          ],
        },
      ]),
    );

    const result = await compileExamPackage(root);

    expect(result.documents[0].fragments?.map((fragment) => fragment.id)).toEqual([
      "guide-p1-f1",
      "guide-p1-f2",
    ]);
    expect(result.questions[0].sources[0]).toMatchObject({
      documentId: "guide",
      page: 1,
      fragmentId: "guide-p1-f2",
    });
    expect(result.questions[0].sources[0].quote).toBeUndefined();
  });

  it("rejects duplicate question IDs", async () => {
    const root = await createFixture();
    const question = {
      id: "q-01",
      officialNumber: 1,
      officialText: "Question",
      displayText: "Question",
      groupId: "core",
      groupTitle: "Core",
      referenceAnswer: "Answer",
      emphasis: [],
      sources: [{ documentId: "guide", page: 1 }],
    };
    await writeFile(
      path.join(root, "questions.json"),
      JSON.stringify([question, { ...question, officialNumber: 2 }]),
    );

    await expect(compileExamPackage(root)).rejects.toThrow("Duplicate question ID: q-01");
  });

  it("rejects missing pages and unconfirmed quotes", async () => {
    const root = await createFixture();
    await writeFile(
      path.join(root, "questions.json"),
      JSON.stringify([
        {
          id: "q-01",
          officialNumber: 1,
          officialText: "Question",
          displayText: "Question",
          groupId: "core",
          groupTitle: "Core",
          referenceAnswer: "Answer",
          emphasis: [],
          sources: [
            { documentId: "guide", page: 2 },
            { documentId: "guide", page: 1, quote: "not in the document" },
          ],
        },
      ]),
    );

    await expect(compileExamPackage(root)).rejects.toThrow(/page 2 does not exist/);
  });
});
