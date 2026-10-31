# Локальная модель Windows: кандидат, а не подтверждённая конфигурация

Проверено 31.10.2026: доступный рабочий ПК имеет Intel Graphics, не RTX; владелец подтвердил, что RTX 3070 Ti/32ГБ находится на другом домашнем ПК. На нём ещё не выполнены команды/замеры. VRAM, CUDA, полное GPU-размещение и качество не заявляются проверенными.

## Закреплённые источники

[model-lock.json](../deploy/model/model-lock.json) содержит официальный Qwen/Qwen3-8B-GGUF, revision 7c41481f57cb95916b40956ab2f0b139b296d974, Qwen3-8B-Q4_K_M.gguf, 5,027,783,488 bytes и LFS SHA256. Лицензия Apache-2.0 подтверждена [официальной карточкой](https://huggingface.co/Qwen/Qwen3-8B-GGUF/blob/7c41481f57cb95916b40956ab2f0b139b296d974/README.md). Лицензия не заменяет проверку качества/безопасности обработки данных.

llama.cpp b12019: официальные Windows CUDA12.4 x64 binary+cudart, опубликованные SHA256 из [релиза](https://github.com/ggml-org/llama.cpp/releases/tag/b12019). GitHub latest v0.8.0 содержал только nightly pointer, поэтому бинарник закреплён конкретным nightly, а не latest. Метаданные источников проверены; архивы не исполнялись на этом Intel-ПК. Installer на владельческом ПК проверяет архивы, веса и исполнимый --help, создаёт отдельное evidence с фактическим хешем exe.

## Первичная установка на настоящем ПК

Установить официальный NVIDIA driver и PowerShell7. Выбрать постоянную локальную папку с минимум9GiB свободного места, не Temp/синхронизируемый публичный каталог. Пример пути ниже нужно заменить реальным диском владельца:

```powershell
pwsh -File deploy/model/Install-Model.ps1 -ModelRoot 'D:\Models\BetweenLines'
pwsh -File deploy/model/Start-Model.ps1 -ModelRoot 'D:\Models\BetweenLines'
# In another terminal, stop only this dedicated executable path:
pwsh -File deploy/model/Stop-Model.ps1 -ModelRoot 'D:\Models\BetweenLines'
```

Start работает в foreground, вывод сервера отбрасывается; сообщения/ответы не записываются. API key генерируется в endpoint.key с ограниченным ACL, передаётся llama через --api-key-file, не argv. Только владелец переносит значение в LOCAL_LLM_API_KEY cloud secrets; в чат/Git не отправлять. На первый запуск bind127.0.0.1; это не соединение с облаком.

Начальный профиль: context4096, parallel1, GPU layers24, batch/ubatch128, output≤1024, client timeout90s, запас VRAM цель≥1536MiB. Это гипотеза. Снять nvidia-smi до старта, на пике генерации и после. Если OOM/недостаточно запаса — остановить и явно снизить GPU layers (например16) или context (например2048). Не менять веса/модель молча; при неприемлемой задержке/качестве согласовать сравнение меньшей модели отдельным измерением.

## Thinking и измерения

По [документации закреплённого server](https://raw.githubusercontent.com/ggml-org/llama.cpp/b12019/tools/server/README.md) используются --jinja, --reasoning off, chat-template-kwargs enable_thinking=false, --no-webui и --no-agent. Сам --reasoning-format none не выключает thinking: он может оставить его в content. /no_think не используется как доказательство.

После предупреждения о реальной генерации владелец на model PC задаёт LOCAL_LLM_BASE_URL=http://127.0.0.1:8080/v1, alias/key только в локальном env и запускает:

```sh
npm run model:check -- --requests 1
# Only after reviewing the first result/status and GPU headroom:
npm run model:check -- --requests 10
```

Probe фактически вызывает /apply-template и требует пустой закрытый thinking-prefix выбранного Qwen-шаблона, затем /v1/chat/completions: reasoning_effort=none, enable_thinking=false, schema-constrained output. Любой reasoning_content/think tags/partial JSON/truncated answer → отказ; никакого извлечения «похожего JSON» из сырого текста. Проверяются analysis/evidence и say_direct схемы. Сохраняются только N/latency/статусы/ожидаемый хеш, не промпты/ответы/ключи. Результат в .tools/model-benchmark.json — синтетический protocol/schema benchmark, не human quality и не Telegram E2E.

Нужно отдельно проверить длинные допустимые input, все учебные схемы/русский язык и человеческую полезность. Текущий отчёт: N=0, p50/p95=null, VRAM/RAM не измерены. Параметры принимаются только после фактического evidence.

## Закрытая сеть

На QQCloud и model PC владелец устанавливает Tailscale с [официальной страницы](https://tailscale.com/download), входит в свой tailnet, проверяет устройства и выдаёт tag:coach-bot и tag:coach-llm. Записать фактическую версию клиента на каждом узле. На доступном ПК Tailscale отсутствует; членство/ACL не настроены агентом.

[deploy/tailscale-policy.json](../deploy/tailscale-policy.json) разрешает только bot tag→LLM tag tcp8080. Владелец проверяет полный tailnet policy: существующий allow-all нельзя оставить рядом и считать ограничение действующим. Не применять шаблон слепо к чужим устройствам: [синтаксис grants/tests](https://tailscale.com/docs/reference/syntax/policy-file).

На Windows администратор проверяет effective default inbound Block и отсутствие широких allow на программу/порт. Затем:

```powershell
pwsh -File deploy/model/Set-ModelFirewall.ps1 -ModelRoot 'D:\Models\BetweenLines' -HomeTailscaleIp '<home-tailnet-ip>' -CloudTailscaleIp '<cloud-tailnet-ip>'
pwsh -File deploy/model/Start-Model.ps1 -ModelRoot 'D:\Models\BetweenLines' -BindAddress '<home-tailnet-ip>' -CloudTailscaleIp '<cloud-tailnet-ip>'
```

Скрипт не отключает firewall/не удаляет чужие правила/не меняет роутер. При overlap или default Allow он блокирует настройку и требует решения владельца. Start не принимает0.0.0.0. Для изменения адресов сначала вручную пересмотреть только правило BetweenLines-PrivateLLM.

На cloud: tailscale ping -c5 <home-ip>, затем services:check/model:check из контейнерной сети. Зафиксировать direct или DERP и измеренную ping/HTTP latency; при relay не заявлять direct. Проверить с постороннего tailnet-узла запрет8080; локальный LAN/public интернет не должен достигать endpoint. Router port forwarding/публичный tunnel запрещены. Даже /health без API key закрывается сетью.
