# Deploy Telegram-only

Актуальны [runbook](runbook.md), [compose.production.yaml](../compose.production.yaml), [Windows model scripts](../deploy/model/) и [ACL template](../deploy/tailscale-policy.json).

QQCloud: один Node bot/domain + PostgreSQL, 1CPU/2ГБ; домашняя модель не на VM. Образ собирается на ПК/CI, на VM только load/pull/migrate/run. Нет портов web/API/PG, пользовательский доступ через long polling. compose.staging.yaml теперь включает только Telegram template; прежний web шаблон [архивирован](archive/compose.web-staging.yaml).

Параметры VM/дата-центра/домен не выдумываются. Cloud access ещё не предоставлен; домашний GPU — на другом ПК владельца. Production ресурсы/сеть/SMTP/полный live пока не проверены. Caps и restart policy не доказательство работоспособности.
