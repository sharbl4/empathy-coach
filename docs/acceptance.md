# Приёмка и границы проверок

CI: чистое npm ci, lint, typecheck, схемы/фикстуры/JSON docs, HTTP health/error, Playwright с настоящим HTTP, production build, Docker build/runtime. После storage PR #1 CI также мигрирует runtime-БД, отдельную пустую storage test-БД дважды и запускает реальные DB-тесты с NODE_ENV=test. Отсутствие TEST_DATABASE_URL больше не позволяет незаметно пропустить storage tests в CI при наличии мигратора.
Это проверка реализованного storage, а не готовность всей v1. Полный продуктовый E2E и живые Auth/GigaChat/почта остаются отдельными незавершёнными gates.

Обязательные release gates (пока не пройдены):

- Все 12 пунктов docs/product.md и пять учебных механик на живой модели.
- Письма регистрации/confirmation/recovery новому внешнему пользователю, повторный вход/выход.
- Два аккаунта: чужие sessions/runs/roleplays и вложенные ID недоступны.
- Revision conflict, старые результаты не показаны как текущие; параллельные вкладки не затирают данные.
- Duplicate POST не дублирует ходы/события; ключ с иным payload → 409.
- Failed turn/finish retry не дублирует пользовательскую реплику; третий ход и ранний finish сохраняют итог.
- Restart pending → RUN_INTERRUPTED, неопределённый платный вызов не повторяется автоматически.
- Timeout/429/invalid JSON/отказ модели, Auth/DB outage, отсутствие ключа, восстановление UI без потери ввода.
- Refresh/relogin/restart сохраняют историю, ожидание и шаги. Поиск/пагинация не пересекают владельцев.
- Удаление сессии/всех данных удаляет прогресс; поздний output не восстанавливает удалённое.
- Пустая БД мигрирует; повтор миграции безопасен; test/seed не используют production.
- Full Playwright: Auth → session → analyze → reply → exercise → role → history → progress → delete.
- Production не допускает тестовый Auth bypass; mock явно обозначен, live error не подменяется.
- Mobile/keyboard/labels/focus, все loading/empty/error/retry состояния.
- Docker runtime, ready с реальной БД, HTTPS, SPA refresh и неизвестный /api возвращает JSON 404.
- Secrets/переписок/ответов/токенов нет в Git, клиенте и логах; backup и откат проверены.

Реальный Auth и GigaChat live проверяются отдельно от CI; test adapters не подтверждают доступность сервисов.
