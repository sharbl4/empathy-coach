# Передача foundation

Исходный контракт: packages/contracts 0.1.0. Это версия для review, не утверждение согласования с Димой/Даней.
Рабочая ветка feat/foundation. Точный стартовый commit — HEAD ветки после передачи; финальный отчёт содержит полный SHA.

Дима: сначала review docs/architecture.md и contracts. Подтвердить SQL, pg 8.16.3, Supabase 2.76.1 и retry-семантику Антону. Затем apps/api: migrations, Auth getUser, ownership, CRUD, runs и GigaChat. Мигратор в src/db/migrate.ts. Не менять контракт/lockfile без Антона. Тесты с отдельной БД; добавить product CI gate после реализации.

Даня: apps/web от того же commit. Импортировать схемы/типы @between/contracts, фикстуры @between/contracts/fixtures только для тестов и явно обозначенного dev. Auth через Supabase SDK, API Bearer, pending polling 1–2 сек с отменой, idempotency UUID на намерение, revision conflict. Никаких локальных копий DTO и скрытого mock.

Антон: получить параметры облака и env без передачи секретов в чат; staging контейнер/HTTPS; Supabase redirects/почта/recovery; подтверждённые логины для приглашений. Не считать принятым контракт до реального review.
