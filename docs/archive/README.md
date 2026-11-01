# Архив web/Supabase/GigaChat

Заменён решением Антона 31.10.2026. Не инструкция production; актуальны AGENTS.md и docs/product/architecture/api/acceptance/runbook.

apps/web source оставлен на месте, но исключён из workspace/release/build/start. apps/api/src/{app,server,auth,routes,ai/gigachat} сохранены для истории, исключены из library build. Supabase/Fastify оставлены только dev dependencies для архивных тестов; production prune их удаляет. Старые применённые SQL не меняются.

Архивные API tests app/auth/gigachat/storage/runs/learning/limits/evals и старые scripts/check-services/live-checkpoint/browser E2E остаются исходниками. test:legacy можно запускать отдельно с dev dependencies и disposable DB. Их Supabase/Fastify adapters проверяют прежний transport; они не подтверждают Telegram identity/local model и не заменяют новый gate. Полезные ownership/revision/concurrency/late-output/restart/SQL assertions Дима переносит в domain*.test.ts; integration CI требует новые реальные DB suites и bot tests, отсутствие не считается успехом.

Старый session-create draft #11/issue #12 не следует сливать поверх Telegram без адаптации: соответствующая семантика включена в новый domain contract и задачу #15. Исходные ветки не удаляются. Незавершённый self-hosted Auth стенд предыдущей итерации сохранён в отдельном stash с причиной, не часть нового runtime.
