# Document RAG в Virtex

Этот документ описывает, как работает RAG в режиме **Изучение 2** (`/exams/:examId/document-study`). Он рассчитан на чтение с почти нулевой базы: сначала даёт общую модель, затем привязывает её к конкретным файлам проекта.

## Коротко

RAG расшифровывается как Retrieval-Augmented Generation: перед ответом модель не получает весь учебник, а сначала приложение находит релевантные фрагменты документа, затем передаёт модели только эти фрагменты как контекст.

В Virtex RAG локальный по управлению данными:

- документы и фрагменты берутся из скомпилированного exam package;
- embeddings строятся через настроенную embedding-модель OpenRouter;
- сами векторы хранятся локально в SQLite;
- при каждом вопросе embedding считается только для запроса пользователя;
- поиск по документу выполняется локально через dot product нормализованных векторов;
- найденные страницы и фрагменты передаются в prompt для выбранной текстовой модели.

## Основные файлы

- `client/src/screens/DocumentStudy.tsx` - экран Study Mode 2, список документов, история чатов, отправка сообщений, streaming, источники.
- `client/src/api.ts` - HTTP-адаптер, включая `sendTutorMessage(..., { stream, onDelta })`.
- `server/app.ts` - Express routes для документов, индексации, document chats и сообщений.
- `server/document-retrieval.ts` - подготовка embedding-индекса и retrieval.
- `server/document-rag-profile.ts` - профиль retrieval и token/context budget.
- `server/prompt.ts` - `buildDocumentTutorRequest`, единственный prompt builder для document tutor.
- `server/database.ts` - SQLite-таблицы `rag_documents`, `rag_embeddings`, `message_sources`.
- `scripts/compiler.ts` - извлечение текста из PDF и создание `SourceFragment`.

## Термины

**Документ** - элемент `SourceDocument` из compiled exam package. Для Study Mode 2 берутся только документы, доступные для поиска (`searchable: true`). `official-questions` специально не используется как searchable source.

**Фрагмент** - `SourceFragment`: кусок текста с `id`, номером страницы и текстом. PDF режется постранично, а длинные страницы дополнительно дробятся на части примерно до 1200 символов.

**Embedding** - числовой вектор, который описывает смысл текста. Похожие тексты должны иметь близкие векторы.

**Индекс** - локально сохранённый набор embeddings для фрагментов документа. В UI лучше думать об этом как о "подготовке поиска по документу".

## Подготовка документов

Исходный контент лежит в `content/exams/database-fundamentals`. При сборке content compiler:

1. читает manifest и документы;
2. извлекает PDF text через `pdfjs-dist`;
3. создаёт `SourceFragment` по страницам;
4. режет слишком длинный page text на chunks до 1200 символов;
5. сохраняет compiled package.

На этом этапе embeddings ещё не считаются. Компиляция только готовит текстовые фрагменты.

## Подготовка поиска

Когда пользователь нажимает "Подготовить поиск", клиент вызывает:

```text
POST /api/exams/:examId/documents/:documentId/index
```

Сервер создаёт `DocumentRetrievalService` и вызывает `prepare(exam, documentId)`:

1. выбирает непустые фрагменты документа;
2. отправляет тексты в embedding provider батчами по 32;
3. нормализует каждый вектор;
4. сохраняет vectors в `rag_embeddings`;
5. сохраняет metadata индекса в `rag_documents`.

Статус индекса привязан к:

- `exam.id`;
- `exam.version`;
- `document.id`;
- embedding model;
- content hash документа.

Если compiled fragments изменились, content hash меняется, и статус становится `stale`. Если embedding provider не настроен, документ получает статус `unavailable`.

## Retrieval при вопросе

Когда пользователь задаёт вопрос в document chat, сервер не отправляет модели весь документ.

Поток такой:

1. `server/app.ts` получает сообщение в `/api/chats/:id/messages` или `/api/chats/:id/messages/stream`.
2. `buildChatRequestForSession` видит, что session имеет `scope_type = 'document'`.
3. `DocumentRetrievalService.retrieve(...)` считает embedding только для текста вопроса.
4. Сервер загружает сохранённые vectors выбранного документа из SQLite.
5. Для каждого фрагмента считается normalized dot product.
6. Берутся top matches.
7. Вокруг найденных matches добавляются соседние фрагменты.
8. Повторы фрагментов удаляются.
9. Итоговые фрагменты упорядочиваются и ограничиваются бюджетом контекста.

Профиль по умолчанию задан в `DEFAULT_DOCUMENT_RAG_PROFILE`:

```ts
{
  topK: 10,
  neighborWindow: 2,
  maxContextCharacters: 16_000,
  promptSourceCharacters: 16_000,
  maxCompletionTokens: 6_000,
  maxEstimatedInputTokens: 14_000,
}
```

`neighborWindow: 2` означает, что рядом с каждым сильным совпадением берутся до двух соседних фрагментов слева и справа. Это важно для учебников: точный термин может быть в одном chunk, а объяснение или пример - рядом.

## Prompt для модели

Prompt собирается только в `buildDocumentTutorRequest` (`server/prompt.ts`).

В модель передаются:

- системные правила document tutor;
- активная persona/profile;
- style guide экзамена;
- metadata экзамена и выбранного документа;
- retrieved fragments как JSON в `Document context`;
- ограниченная история диалога;
- текущий вопрос пользователя.

В prompt не передаются:

- весь документ целиком;
- весь compiled package;
- official questions как searchable source;
- reference answers, если они не являются выбранным документом;
- unrelated pages.

Текущий вопрос режется до 4000 символов. История диалога режется до 4000 символов суммарно и до 1000 символов на сообщение. Это защищает prompt от бесконтрольного роста.

## Текстовая модель и настройки

Study Mode 2 использует тот же runtime text provider, что и остальной tutor chat:

```ts
currentAIProvider() =
  options.runtimeAI?.getTextProvider() ?? options.aiProvider ?? null
```

`RuntimeAIService` читает выбранные provider/model из SQLite settings (`ai.text.provider`, `ai.text.model`) и пересобирает provider после сохранения настроек. Отдельной hardcoded text model для Study Mode 2 нет.

Embeddings настраиваются отдельно: текстовая модель отвечает за генерацию ответа, embedding-модель - за поиск фрагментов.

## Streaming

Клиент может отправлять document chat через streaming endpoint:

```text
POST /api/chats/:id/messages/stream
```

Сервер отвечает NDJSON-событиями:

- `chunk` - очередной кусок текста;
- `done` - итоговый turn с сохранёнными `user` и `assistant`;
- `error` - ошибка генерации.

Если provider поддерживает streaming, сервер прокидывает chunks от provider. Если provider не поддерживает streaming, сервер всё равно может вернуть ответ через streaming endpoint одним chunk. Это улучшает единообразие клиента, но не уменьшает расход токенов.

## Источники в ответах

Retrieved sources сохраняются вместе с assistant message в `message_sources`. В UI показываются только уникальные страницы в конце ответа:

```text
Стр. 7
Стр. 8
```

Fragment ids, document role/title и проценты score скрыты, потому что для пользователя они шумят. Score всё ещё полезен внутри retrieval, но не является понятной оценкой качества ответа.

## Расход токенов

Есть два разных типа расходов.

**Подготовка поиска** считает embeddings для всех searchable fragments выбранного документа. Это разовая или редкая операция на документ, но для большого учебника она может быть самой крупной embedding-операцией.

**Обычный вопрос в чате** считает embedding только для запроса пользователя, затем отправляет текстовой модели prompt с найденными fragments. Документ целиком в prompt не попадает.

В текущем профиле rich document-chat request обычно получается примерно:

- 5.5k-8k input tokens при насыщенном retrieval context;
- до 6k output tokens из-за `maxCompletionTokens`;
- hard guardrail `maxEstimatedInputTokens = 14k` для document tutor prompts.

Streaming не снижает token cost: он только меняет доставку ответа на клиент. Основные факторы стоимости - размер retrieved context, длина истории диалога и максимальный размер ответа.

## Практические ограничения

- Если документ не подготовлен, retrieval вернёт ошибку `Document index is not ready`.
- Если embedding model изменилась, нужен новый индекс для этой модели.
- Если compiled fragments изменились, старый индекс считается stale.
- Если вопрос слишком общий, retrieval может подтянуть много соседних страниц; это полезно для обзора, но дороже по prompt tokens.
- Если retrieved fragments не отвечают на вопрос, prompt требует прямо сказать, что выбранный документ не дал достаточно данных.

## Как проверять

Основные команды:

```powershell
npm run typecheck
npm test
npm run content:validate
npm run build
npm run rag:check
```

При изменениях в retrieval, prompt context, compiled fragments или embedding settings особенно важен `npm run rag:check`.
