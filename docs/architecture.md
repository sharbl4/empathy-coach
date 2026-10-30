# Архитектура и SQL: исходное предложение v0.1.0

React/Vite → Supabase Auth (только аккаунты); React → Fastify /api с Bearer → PostgreSQL и GigaChatProvider.
Production — один постоянный Node-процесс, web+api один origin. Dev — Vite proxy.
Без Redis/микросервисов/дополнительного оркестратора. Фоновые runs требуют постоянно работающего процесса.

Backend вызывает auth.getUser(token), использует только проверенный userId. Auth outage закрывает доступ.
Чужие ID и чужие вложенные ссылки возвращают 404. Параметризованный pg SQL, схема app закрыта от Data API и клиентских ролей.
Зависимости foundation: pg 8.16.3 и @supabase/supabase-js 2.76.1 в обоих apps. Требуется review Димы, согласование пока не получено.

| Таблица | Поля и ограничения |
|---|---|
| profiles | id=Auth UUID PK, display_name, onboarding_completed_at, created_at |
| sessions | id UUID PK, user_id, title, situation JSONB, guess JSONB, revision>0, created_at, updated_at |
| ai_runs | id UUID PK, session_id FK CASCADE, user_id, revision, kind, status, input/output JSONB, prompt_version, error_code, idempotency_key, payload_hash, created_at, updated_at |
| roleplays | id UUID PK, session_id FK CASCADE, user_id, revision, status, turn_count 0..3, feedback JSONB, created_at, updated_at |
| roleplay_messages | id UUID PK, roleplay_id FK CASCADE, sequence, role, content, created_at |
| practice_events | id UUID PK, user_id, session_id FK CASCADE, source_run_id/source_roleplay_id, kind, skill, created_at |

Индексы: sessions(user_id,updated_at DESC,id DESC), ai_runs(session_id,revision,kind); UNIQUE(user_id,idempotency_key), UNIQUE(roleplay_id,sequence), уникальный источник события практики.
Дима определяет миграциями FK/check/partial unique индексы. Одна pending AI-операция на сессию; транзакционные блокировки на turn/finish/retry/revision.
Сортировка истории: updated_at DESC,id DESC. Cursor — непрозрачный base64url от пары timestamp/UUID; сервер валидирует содержимое и всегда ограничивает user_id. При обновлении страниц история может смещаться.

Idempotency hash включает метод, ресурс и нормализованный body. Проверка владельца выполняется до возврата старого run.
Старый ключ+тот же payload возвращает прежний run; другой payload — 409. Failed retry — новый ключ.
Roleplay retry принимает только failed roleplay-run текущей revision, отвечает на сохранённое сообщение без нового user message.
Третий ответ сразу приводит к feedback, не к четвёртой реплике; finish после ≥1 ответа. Для failed финала используется тот же retry.
Внешний вызов вне SQL-транзакции; поздний output сохраняется только при существующей сессии, текущей revision и актуальном pending run.
На старте потерянные pending → failed/RUN_INTERRUPTED без автоматического платного повтора.
Редактирование и удаление одной pending-сессии — 409; удаление всех данных отменяет pending и исключает позднее восстановление.
Прогресс по уникальным успешным событиям, каскадное удаление учитывается в счётчиках.

Мигратор Димы: версии, advisory lock, транзакции; применённые SQL не менять. Foundation SQL не создаёт.
Не логировать body/ответы/Authorization. Текущий каркас отключает logger; в будущем только безопасные requestId/runId/code.
GigaChat: один вызов/run, bounded queue, timeout и concurrency. Токен кешируется, один refresh одновременно. Strict JSON schema из Zod и повторная серверная валидация. Цитаты analysis сверять с message, feedback с draft. TLS проверять, CA при необходимости добавить, не отключать.

Официальные источники: [Fastify 5](https://fastify.dev/docs/latest/Reference/Server/), [fastify-static compatibility](https://github.com/fastify/fastify-static), [Vite 7](https://v7.vite.dev/guide/), [Zod 4](https://zod.dev/api), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [GigaChat](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output). Точные runtime версии закреплены manifests/lockfile и проверяются совместным запуском.
