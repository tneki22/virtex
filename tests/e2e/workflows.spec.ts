import { expect, test } from "@playwright/test";

const longAnswer = "Транзакция является логической единицей работы. Она обеспечивает атомарность, согласованность, изоляцию и долговечность изменений в базе данных.";

async function openRightPanelOnTablet(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: /открыть ответы и заметки/i });
  if (await button.isVisible()) await button.click();
}

test("root opens the two-mode exam overview and study restores a draft", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/exams\/mock-database$/);
  await expect(page.getByRole("link", { name: /изучение/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /открыть экзамен/i })).toBeVisible();
  await expect(page.getByText(/практика/i)).toHaveCount(0);

  await page.getByRole("link", { name: /изучение/i }).click();
  await expect(page.getByRole("heading", { name: /транзакции и свойства acid: вопрос 1/i })).toBeVisible();
  await openRightPanelOnTablet(page);
  await expect(page.getByText(/логическая единица работы с гарантиями acid/i)).toBeVisible();

  const editor = page.getByRole("textbox", { name: /ответ на вопрос/i });
  await editor.fill("Мой локальный черновик");
  await page.reload();
  await expect(editor).toHaveValue("Мой локальный черновик");
});

test("study mode saves a bookmark and a note", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await expect(page.getByRole("heading", { name: /транзакции и свойства acid/i })).toBeVisible();
  await page.getByRole("button", { name: /добавить в закладки/i }).click();
  await expect(page.getByRole("button", { name: /убрать из закладок/i })).toBeVisible();
  await openRightPanelOnTablet(page);
  await page.getByRole("tab", { name: /заметки/i }).click();
  await page.getByRole("textbox", { name: /^заметка$/i }).fill("Повторить изоляцию");
  await page.getByRole("button", { name: /сохранить заметку/i }).click();
});

test("three-question exam advances sequentially and shows a summary", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByText("3", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "3" })).toBeChecked();
  await page.getByRole("button", { name: /открыть экзамен/i }).click();
  await page.getByRole("button", { name: /начать экзамен/i }).click();

  for (let position = 1; position <= 3; position += 1) {
    await expect(page.getByRole("heading", {
      name: new RegExp(`транзакции и свойства acid: вопрос ${position}`, "i"),
    })).toBeVisible();
    await expect(page.getByText(`${position} из 3`)).toBeVisible();
    await page.getByRole("textbox", { name: /ответ на вопрос/i }).fill(longAnswer);
    await page.getByRole("button", { name: /отправить ответ/i }).click();

    if (position < 3) {
      await page.getByRole("button", { name: new RegExp(`следующий вопрос ${position + 1} из 3`, "i") }).click();
    } else {
      await page.getByRole("button", { name: /завершить экзамен/i }).click();
    }
  }

  await expect(page.getByRole("heading", { name: /результат серии/i })).toBeVisible();
  await expect(page.getByText(/XP/i)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /ответ на вопрос/i })).toHaveCount(0);
});

test("desktop panel widths are adjustable and persistent", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only resizable panels");
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  const separator = page.getByRole("separator", { name: /ширину списка вопросов/i });
  const box = await separator.boundingBox();
  if (!box) throw new Error("Panel separator is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 80);
  await page.mouse.up();

  const resized = await page.locator(".workspace-grid").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--left-panel"),
  );
  await page.reload();
  await expect(page.locator(".workspace-grid")).toHaveCSS("--left-panel", resized);

  await separator.focus();
  await separator.press("ArrowRight");
  await separator.dblclick();
  await expect(page.locator(".workspace-grid")).toHaveCSS("--left-panel", "280px");
});

test("voice transcription fills the editor without submitting", async ({ page }) => {
  await page.addInitScript(() => {
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
  });
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await page.getByRole("button", { name: /диктовать/i }).click();
  await page.getByRole("button", { name: /стоп/i }).click();
  await expect(page.getByRole("textbox", { name: /ответ на вопрос/i })).toHaveValue(/транзакция/i);
  await expect(page.getByText(/ответ проверен/i)).toHaveCount(0);
});

test("tablet keeps side panels as drawers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "Tablet-only drawer behavior");
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await expect(page.getByRole("separator")).toHaveCount(0);
  await page.getByRole("button", { name: /открыть список вопросов/i }).click();
  await expect(page.getByRole("complementary", { name: /навигация по вопросам/i })).toBeVisible();
  await page.getByRole("button", { name: /закрыть список/i }).click();
  await openRightPanelOnTablet(page);
  await expect(page.getByRole("tab", { name: /ответы/i })).toBeVisible();
});

test("reduced motion reveals AI text immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  const editor = page.getByRole("textbox", { name: /ответ на вопрос/i });
  await editor.fill(longAnswer);
  await page.getByRole("button", { name: /отправить ответ/i }).click();
  await expect(page.getByText("Ответ проверен.")).toBeVisible();
  await expect(page.getByRole("button", { name: /показать сразу/i })).toHaveCount(0);
  const duration = await page.locator(".review-card").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).animationDuration),
  );
  expect(duration).toBeLessThanOrEqual(0.00001);
});
