# Deploy web + Telegram v2

Решение Telegram-only заменено31.10.2026. Актуальная инструкция: [runbook](runbook.md). Production image собирает contracts→api/bot→web, один Node scripts/application.mjs связывает side-effect-free factories. PG отдельно; HTTPS Caddy2.11.7. Образ пока не собирается без B1/B2/C1 и миграции legacy web Auth.
Compose: app640MiB/db512MiB/proxy64MiB, постоянные pgdata/Caddy volumes, restart и health; только80/443 наружу. Это стартовые caps, не замеры. Модель на другом Windows ПК, никаких hosted inference.
QQCloud permanent process/disk/Docker, домен/HTTPS и country DC ещё не проверены. Публичного URL нет; localhost не staging. Нужны конкретные параметры VM/DNS и доступ владельца.
