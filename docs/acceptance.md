# Приёмка Telegram-only

Решение Антона 31.10.2026 заменяет browser E2E/HTTPS SPA/Supabase/GigaChat. Независимые ownership/revision/idempotency/deletion/validation проверки обязательны.

CI: contracts first, root checks, library import без сервера, build bot image без web/hosted inference, новые реальные DB-тесты фасады. Нет фасады/бота/новых DB-тестов → явный блокирующий integration gate. Архив/фикстуры не новый live.

Реальные gates:

- Отдельные test bot/database, секреты настроены владельцем без вывода.
- Чужой телефон: Telegram → QQCloud → Windows llama.cpp → валидированный ответ. Нет запросов GigaChat/Supabase/hosted inference и сайта.
- Настоящие SMTP-коды/confirmation, TTL/attempt/resend/одноразовость; согласие/отказ/отзыв/onboarding.
- Все механики product.md, say_direct, история и диалог сохраняются после restart.
- Два аккаунта: forged context/чужие object IDs/callbacks/group/channel не дают доступа.
- Повтор update/неопределённый ответ/конкурентность/revision и второй poller не дублируют операции.
- Выключение/сон ПК/потеря сети → понятная ошибка, история доступна, нет выдуманного ответа. Восстановление только через явный retry.
- Strict JSON/evidence, нет reasoning в ответе; injection остаётся данными; большой input не теряется молча.
- Удаление/поздний output/backup и restore на отдельной БД. Старые миграции/данные сохранены.
- Stop/reboot/lease, один poller, длительная нагрузка 1CPU/2GB; PG не опубликован.
- Проверены cloud→model и запрет постороннему узлу, фактический direct/relay.
- Записаны hash/model/version/license, VRAM, RAM bot+DB/запас ОС, N запросов, p50/p95/failed/invalid. Лимиты не доказательство работы.
- Нет приватного контента/email/кодов/токенов в логах/Git. Правовая готовность Telegram/SMTP/мест размещения проверяется отдельно.

Статус: контракт проверен; фасада/transport зависят от #15/#16. Домашний GPU/QQCloud недоступны. Новых реальных LLM/Telegram запросов 0, p50/p95/VRAM/нагрузочная RAM не измерены.
