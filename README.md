# Empather

Команда **shertwg^3**. Хакатон «Город героев», тема «Чувствовать». Целевой продукт: веб и Telegram — с одним аккаунтом, историей и доменом.

Решение Антона31.10.2026 заменяет Telegram-only/архив apps/web. Supabase Auth, GigaChat и hosted inference не возвращаются. QQCloud1CPU/2ГБ: PostgreSQL и один app-процесс Fastify+polling+workers. Fastify обслуживает web/dist и /api с одного origin; bot вызывает фасаду напрямую. Windows GPU-PC через private network выполняет локальную модель.

## Актуальный финальный кандидат

Финальная ветка `feat/final-defense` объединяет проверенную интеграцию и последний патч участников. Точный runtime/PR, свежие результаты и live-блокеры: [журнал](docs/integration-progress.md). [Маршрут защиты](docs/demo-final.md). Старые SHA/статусы ниже сохранены как исходная точка, а не текущая аттестация. Продукт тренирует общение; не обещает доказанного роста эмпатии или диагностики.

## Старт и контракт

Основа ed7278474e42dbf67624c7e241b9cd16253d8b65/PR18 сохранена. Текущий контракт A1 2.2.1 —9cd742f, @between/contracts/product и /http; [совместимое дополнение](docs/contract-v2.2.1.md). Общий исполняемый candidate `test/stack-a1-nov01`/6755408 включает backend fabed23 и interfaces f12d309. Точная передача: [handoff](docs/handoff-v2.md).
Полный обязательный [продукт](docs/product.md), [архитектура](docs/architecture.md), [приёмка](docs/acceptance.md).
В candidate есть настоящие facade/HTTP/bot/web: общая сборка, PostgreSQL/HTTP и13 browser-сценариев проверены; Supabase отсутствует в активном клиенте и production dependencies. PR22/23 отдельно не слиты. Контрактная ветка без candidate не является полной исполняемой поставкой. Release guard и обязательные CI jobs сохранены; live Telegram/QQCloud/GPU этим не подтверждаются.

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

На этом рабочем ПК Intel Graphics/около16ГБ; RTX3070Ti/32ГБ — другой ПК владельца. Локального GPU на этом ПК нет; домашний ПК и QQCloud проверяются отдельно, фактические live-результаты см. в журнале. Gemma3 4B Q4_K_M и Qwen3-4B-Instruct-2507 сравниваются после принятия владельцем условий и фактических замеров, не выбираются по обещанию5с.

[Runbook](docs/runbook.md), [модель](docs/local-model.md), [локальная передача/оценка](docs/handoff-v2.md), [демо](docs/demo.md). Старые plans/legacy tests сохранены, но не описывают новый runtime.

Server env validators только @between/contracts/runtime, browser export запрещён; /product и /http не импортируют runtime. [Новые persistent dialogue и support правила](docs/contract-v2.2.md), [review PR21/22](docs/review-pr21.md).
