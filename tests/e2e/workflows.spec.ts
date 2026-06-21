import { expect, test } from "@playwright/test";

const longAnswer = "Транзакция является логической единицей работы. Она обеспечивает атомарность, согласованность, изоляцию и долговечность изменений в базе данных.";

async function openRightPanelOnTablet(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: /открыть ответы и заметки/i });
  if (await button.isVisible()) await button.click();
}

async function createStudyChat(
  page: import("@playwright/test").Page,
  kind: "tutor" | "review",
) {
  await page.getByRole("button", { name: /новый чат/i }).click();
  await page.getByRole("button", {
    name: kind === "tutor" ? /разобрать тему/i : /проверить ответ/i,
  }).click();
  await page.getByRole("button", { name: /создать чат/i }).click();
}

test("root opens two modes and a tutor dialogue survives reload", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/exams\/mock-database$/);
  const studyLink = page.getByRole("link", { name: /открыть изучение/i });
  await expect(studyLink).toBeVisible();
  await expect(page.getByRole("link", { name: /изучение 2/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /открыть экзамен/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /материалы к экзамену/i })).toBeVisible();
  await expect(page.getByText(/практика/i)).toHaveCount(0);

  await studyLink.click();
  await createStudyChat(page, "tutor");

  const editor = page.getByRole("textbox", { name: /сообщение чата/i });
  await page.getByRole("button", { name: /пример с пиццей/i }).click();
  await expect(editor).toHaveValue(/доставки пиццы/i);
  await expect(page.getByLabel(/предыдущие реплики/i)).toHaveCount(0);
  await page.getByRole("button", { name: /отправить сообщение/i }).click();
  await expect(page.getByText(/заказ пиццы проходит как единая операция/i)).toBeVisible();

  await editor.fill("А как это связано с атомарностью?");
  await page.getByRole("button", { name: /отправить сообщение/i }).click();
  await expect(editor).toHaveValue("");
  await expect(page.getByLabel(/предыдущие реплики/i).getByText("А как это связано с атомарностью?")).toBeVisible();

  await page.reload();
  await expect(page.getByText(/заказ пиццы проходит как единая операция/i)).toBeVisible();
  await expect(page.getByLabel(/предыдущие реплики/i).getByText("А как это связано с атомарностью?")).toBeVisible();
  await editor.fill("Сформулируй вывод одним предложением.");
  await page.getByRole("button", { name: /отправить сообщение/i }).click();
  await expect(editor).toHaveValue("");
  await expect(page.getByLabel(/предыдущие реплики/i).getByText("Сформулируй вывод одним предложением.")).toBeVisible();
});

test("document study prepares an index and renders sources", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByRole("link", { name: /изучение 2/i }).click();
  await expect(page).toHaveURL(/\/exams\/mock-database\/document-study$/);
  await expect(page.getByRole("button", { name: /учебный фрагмент/i })).toBeVisible();

  await page.getByRole("button", { name: /подготовить поиск/i }).click();
  await expect(page.getByRole("button", { name: /новый чат по документу/i })).toBeEnabled();
  await page.getByRole("button", { name: /новый чат по документу/i }).click();

  await page.getByRole("textbox", { name: /сообщение/i }).fill("Что такое ACID?");
  await page.getByRole("button", { name: /отправить сообщение/i }).click();

  await expect(page.getByText(/Разберём это/i)).toBeVisible();
  await expect(page.getByRole("list", { name: /страницы источников/i }).getByText("Стр. 1")).toBeVisible();
});

test("overview applies independent text and speech model selections", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await expect(page.getByText(/Текст: OpenRouter · openai\/gpt-5-mini/i)).toBeVisible();

  await page.getByLabel("Провайдер текста").selectOption("groq");
  await page.getByLabel("Модель текста").fill("openai/gpt-oss-20b");
  await page.getByLabel("Провайдер речи").selectOption("openrouter");
  await page.getByLabel("Модель речи").fill("openai/whisper-large-v3");
  await page.getByRole("button", { name: "Сохранить AI-настройки" }).click();

  await expect(page.getByText(/Текст: GroqCloud · openai\/gpt-oss-20b/i)).toBeVisible();
  await expect(page.getByText(/Речь: OpenRouter · openai\/whisper-large-v3/i)).toBeVisible();
});

test("a completed review is restored without another request", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await createStudyChat(page, "review");

  const editor = page.getByRole("textbox", { name: /сообщение чата/i });
  await editor.fill(longAnswer);
  await page.getByRole("button", { name: /^проверить ответ$/i }).click();
  await expect(page.getByText("Ответ проверен.")).toBeVisible();
  await expect(editor).toBeDisabled();

  await page.reload();
  await expect(page.getByText("Ответ проверен.")).toBeVisible();
  await expect(editor).toBeDisabled();
  await expect(page.getByRole("button", { name: /новый чат/i })).toBeVisible();
});

test("study history switches between saved chats without AI calls", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await createStudyChat(page, "tutor");
  const editor = page.getByRole("textbox", { name: /сообщение чата/i });
  await editor.fill("Первый сохранённый разбор");
  await page.getByRole("button", { name: /отправить сообщение/i }).click();

  await createStudyChat(page, "review");
  await expect(page.getByText(/проверка ответа/i).first()).toBeVisible();
  await page.getByRole("button", { name: /история/i }).click();
  await page.getByRole("button", { name: /первый сохранённый разбор/i }).click();
  await expect(page.getByText("Первый сохранённый разбор")).toBeVisible();
  await expect(page.getByRole("button", { name: /отправить сообщение/i })).toBeVisible();
});

test("study mode saves a bookmark and a note", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await page.getByRole("button", { name: /добавить в закладки/i }).click();
  await expect(page.getByRole("button", { name: /убрать из закладок/i })).toBeVisible();
  await openRightPanelOnTablet(page);
  await page.getByRole("tab", { name: /заметки/i }).click();
  await page.getByRole("textbox", { name: /^заметка$/i }).fill("Повторить изоляцию");
  await page.getByRole("button", { name: /сохранить заметку/i }).click();
});

test("three-question exam uses two panels and shows a summary", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByText("3", { exact: true }).click();
  await page.getByRole("button", { name: /открыть экзамен/i }).click();
  await page.getByRole("button", { name: /начать экзамен/i }).click();

  await expect(page.getByRole("complementary", { name: /навигация по вопросам/i })).toHaveCount(0);
  await expect(page.getByLabel(/профиль экзаменатора/i)).toHaveCount(0);
  await expect(page.getByText(/не начат|почти готов|готов/i)).toHaveCount(0);

  for (let position = 1; position <= 3; position += 1) {
    await expect(page.getByText(`Вопрос ${position} из 3`)).toBeVisible();
    await page.getByRole("textbox", { name: /ответ на вопрос/i }).fill(longAnswer);
    await page.getByRole("button", { name: /проверить ответ/i }).click();

    if (position < 3) {
      await page.getByRole("button", { name: new RegExp(`следующий вопрос ${position + 1} из 3`, "i") }).click();
    } else {
      await page.getByRole("button", { name: /завершить экзамен/i }).click();
    }
  }

  await expect(page.getByRole("heading", { name: /результат серии/i })).toBeVisible();
  await expect(page.getByText(/XP/i)).toBeVisible();
});

test("completed exam opens from history with answers and final feedback", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByRole("button", { name: /открыть экзамен/i }).click();
  await page.getByRole("button", { name: /начать экзамен/i }).click();
  await page.getByRole("textbox", { name: /ответ на вопрос/i }).fill(longAnswer);
  await page.getByRole("button", { name: /проверить ответ/i }).click();
  await page.getByRole("button", { name: /завершить экзамен/i }).click();
  await expect(page.getByRole("heading", { name: /результат серии/i })).toBeVisible();

  await page.getByRole("link", { name: /в меню/i }).click();
  await page.getByRole("link", { name: /история/i }).click();
  await page.getByRole("link", { name: /демонстрационный экзамен/i }).click();

  await expect(page.getByText(longAnswer)).toBeVisible();
  await expect(page.getByText("Ответ проверен.")).toBeVisible();
  await expect(page.getByText(/транзакции и свойства acid/i).first()).toBeVisible();
});

test("interrupted exam is deleted and absent from history", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByText("2", { exact: true }).click();
  await page.getByRole("button", { name: /открыть экзамен/i }).click();
  await page.getByRole("button", { name: /начать экзамен/i }).click();
  await page.getByRole("textbox", { name: /ответ на вопрос/i }).fill("Черновик прерванного экзамена");

  await page.getByRole("button", { name: /^выйти$/i }).click();
  await expect(page.getByRole("dialog", { name: /прервать экзамен/i })).toBeVisible();
  await page.getByRole("button", { name: /остаться/i }).click();
  await expect(page.getByRole("textbox", { name: /ответ на вопрос/i })).toHaveValue("Черновик прерванного экзамена");

  await page.getByRole("button", { name: /^выйти$/i }).click();
  await page.getByRole("button", { name: /прервать экзамен/i }).click();
  await expect(page).toHaveURL(/\/exams\/mock-database$/);
  await page.getByRole("link", { name: /история/i }).click();

  await expect(page.getByRole("heading", { name: "Экзамены" })).toBeVisible();
  await expect(page.getByText(/завершённых экзаменов пока нет/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /демонстрационный экзамен/i })).toHaveCount(0);
});

test("desktop panels resize, persist, and do not overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only resizable panels");
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  const leftSeparator = page.getByRole("separator", { name: /ширину списка вопросов/i });
  const leftBox = await leftSeparator.boundingBox();
  if (!leftBox) throw new Error("Left panel separator is not visible");
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 70, leftBox.y + 80);
  await page.mouse.up();
  const resized = await page.locator(".workspace-grid").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--left-panel"),
  );
  await page.reload();
  await expect(page.locator(".workspace-grid")).toHaveCSS("--left-panel", resized);

  const rightSeparator = page.getByRole("separator", { name: /ширину панели ответов/i });
  await rightSeparator.focus();
  await rightSeparator.press("End");
  const noOverflow = await page.locator(".workspace-page").evaluate((element) =>
    element.scrollWidth <= element.clientWidth,
  );
  expect(noOverflow).toBe(true);
  await leftSeparator.dblclick();
  await expect(page.locator(".workspace-grid")).toHaveCSS("--left-panel", "280px");
});

test("voice transcription fills a tutor editor without submitting", async ({ page }) => {
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
  await createStudyChat(page, "tutor");
  await page.getByRole("button", { name: /диктовать/i }).click();
  await page.getByRole("button", { name: /стоп/i }).click();
  await expect(page.getByRole("textbox", { name: /сообщение чата/i })).toHaveValue(/транзакция/i);
  await expect(page.getByLabel(/предыдущие реплики/i)).toHaveCount(0);
});

test("tablet keeps study side panels as drawers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "Tablet-only drawer behavior");
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await expect(page.getByRole("separator")).toHaveCount(0);
  await page.getByRole("button", { name: /открыть список вопросов/i }).click();
  await expect(page.getByRole("complementary", { name: /навигация по вопросам/i })).toBeVisible();
  await page.getByRole("button", { name: /закрыть список/i }).click();
  await openRightPanelOnTablet(page);
  await expect(page.getByRole("tab", { name: /эталон/i })).toBeVisible();
});

test("reduced motion reveals tutor text immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/exams/mock-database/workspace/q-1?mode=study");
  await createStudyChat(page, "tutor");
  const editor = page.getByRole("textbox", { name: /сообщение чата/i });
  await editor.fill("Объясни атомарность");
  await page.getByRole("button", { name: /отправить сообщение/i }).click();
  await expect(page.getByText(/сначала выделите определение/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /показать сразу/i })).toHaveCount(0);
});
