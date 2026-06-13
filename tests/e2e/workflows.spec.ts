import { expect, test } from "@playwright/test";

async function openMaterialsOnTablet(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: /открыть материалы/i });
  if (await button.isVisible()) await button.click();
}

test("study mode reveals the reference and restores an offline draft", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /готовьтесь по источникам/i })).toBeVisible();
  await page.getByRole("link", { name: /демонстрационный экзамен/i }).click();
  await page.getByRole("link", { name: /источник, черновик и эталон/i }).click();

  await expect(page.getByRole("heading", { name: /транзакции и свойства acid/i })).toBeVisible();
  await page.getByRole("button", { name: /показать эталон/i }).click();
  await expect(page.getByText(/логическая единица работы с гарантиями acid/i)).toBeVisible();

  const editor = page.getByRole("textbox", { name: /ответ на вопрос/i });
  await editor.fill("Мой локальный черновик");
  await page.reload();
  await expect(editor).toHaveValue("Мой локальный черновик");
});

test("practice mode saves a bookmark and a note", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=practice");
  await expect(page.getByRole("heading", { name: /транзакции и свойства acid/i })).toBeVisible();
  await page.getByRole("button", { name: /добавить в закладки/i }).click();
  await expect(page.getByRole("button", { name: /убрать из закладок/i })).toBeVisible();
  await openMaterialsOnTablet(page);
  await page.getByRole("tab", { name: /заметки/i }).click();
  await page.getByRole("textbox", { name: /^заметка$/i }).fill("Повторить изоляцию");
  await page.getByRole("button", { name: /сохранить заметку/i }).click();
});

test("exam mode selects one question and locks sources", async ({ page }) => {
  await page.goto("/exams/mock-database");
  await page.getByRole("link", { name: /один случайный вопрос/i }).click();
  await openMaterialsOnTablet(page);
  await expect(page.getByText(/источники откроются после завершения/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /вопрос 1:/i })).toBeDisabled();
});

test("keyboard submission handles clarification and an AI failure", async ({ page }) => {
  await page.goto("/exams/mock-database/workspace/q-1?mode=practice");
  const editor = page.getByRole("textbox", { name: /ответ на вопрос/i });
  await editor.fill("Короткий ответ");
  await editor.press("Control+Enter");
  await expect(page.getByText(/какие гарантии входят в acid/i)).toBeVisible();

  await editor.fill("[api-error]");
  await page.getByRole("button", { name: /ответить на уточнение/i }).click();
  await expect(page.getByText(/имитация ошибки api/i)).toBeVisible();
});

test("reduced motion removes meaningful animation durations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.getByRole("link", { name: /демонстрационный экзамен/i });
  await expect(card).toBeVisible();
  const duration = await card.evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
});
