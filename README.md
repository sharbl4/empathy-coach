# Между строк

Хакатон «Город героев», тема «Чувствовать». Целевой продукт: веб и Telegram — с одним аккаунтом, историей и доменом.

Решение Антона31.10.2026 заменяет Telegram-only/архив apps/web. Supabase Auth, GigaChat и hosted inference не возвращаются. QQCloud1CPU/2ГБ: PostgreSQL и один app-процесс Fastify+polling+workers. Fastify обслуживает web/dist и /api с одного origin; bot вызывает фасаду напрямую. Windows GPU-PC через private network выполняет локальную модель.

## Старт и контракт

Основа ed7278474e42dbf67624c7e241b9cd16253d8b65/PR18 сохранена. Новая ветка feat/web-telegram-integration. Текущий контракт A1 2.2.0 —a71d379 (2.1/31574f8 заменены в указанных границах), @between/contracts/product и /http, [контракт v2](docs/contract-v2.md).
Полный обязательный [продукт](docs/product.md), [архитектура](docs/architecture.md), [приёмка](docs/acceptance.md).
PR21/22 переносит web/bot на общий домен; Supabase уже убран из их active src. В общей ветке эти PR пока не приняты: старый web сохранён, release guard продолжает блокировать его до успешного review. Реальных domain/http/bot модулей пока нет; integration CI блокируется, а не исключается.

```sh
npm ci
npm run test:contracts
npm run build:web
npm run typecheck
npm run build
docker compose up -d db
npm run db:migrate
npm run dev
npm start
npm run e2e
```

Node24.22.1 LTS, npm workspaces TS/React/Vite/Fastify/Zod/pg. Contracts первыми. Production web build принудительно NODE_ENV=production, без fixture/bypass/legacy Auth. Browser public env только VITE_PUBLIC_*; API same-origin /api. Секреты не VITE и не в клиенте.

Существующий .env и IDE не перезаписываются. Новые параметры заполняет владелец локально/hosting по .env.example; dev/test/prod разделены, test bot/DB отдельные. Веб входит по одноразовой ссылке из своего бота с явным POST-подтверждением, пароли не нужны; cookies HttpOnly/Secure/SameSite, Origin+CSRF и одноразовая browser binding.

На этом рабочем ПК Intel Graphics/около16ГБ; RTX3070Ti/32ГБ — другой ПК владельца. Нет GPU/QQCloud/Tailscale access; N реальных новых inference0. Gemma3 4B Q4_K_M и Qwen3-4B-Instruct-2507 сравниваются после принятия владельцем условий и фактических замеров, не выбираются по обещанию5с.

[Runbook](docs/runbook.md), [модель](docs/local-model.md), [локальная передача/оценка](docs/handoff-v2.md), [демо](docs/demo.md). Старые plans/legacy tests сохранены, но не описывают новый runtime.

Server env validators только @between/contracts/runtime, browser export запрещён; /product и /http не импортируют runtime. [Новые persistent dialogue и support правила](docs/contract-v2.2.md), [review PR21/22](docs/review-pr21.md).
