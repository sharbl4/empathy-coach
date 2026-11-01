# Локальная модель Windows: A2

Фактический текущий ПК: Intel Graphics, ~16ГБ RAM, nvidia-smi и Tailscale не найдены; это НЕ домашний GPU-ПК (владелец подтвердил). Свободно ~213GB на C:. Никаких выводов о RTX/VRAM/драйвере удалённого ПК. N=0, TTFT/p50/p95/VRAM и выбор модели пока неизвестны.

## Зафиксированные кандидаты

Точные revision/file/size/SHA256 и binary hashes: [model-lock.json](../deploy/model/model-lock.json). Default — гипотеза Gemma3 4B IT Q4_K_M; сравнение Qwen3-4B-Instruct-2507 Q4_K_M обязательно перед выбором.
Gemma: [официальная base model](https://huggingface.co/google/gemma-3-4b-it), GGUF издателя llama.cpp [ggml-org](https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF), лицензия [Gemma Terms](https://ai.google.dev/gemma/terms). Владелец читает/принимает условия самостоятельно; доступный download не заменяет принятия.
Qwen: [официальная base model](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), Apache2. GGUF [Unsloth](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) — сторонняя конверсия, НЕ официальный Qwen GGUF. Издатель/revision/hash явно закреплены.
llama.cpp [b12019](https://github.com/ggml-org/llama.cpp/releases/tag/b12019), Windows CUDA12.4 archives проверяются по SHA256, но здесь не исполнялись. [Документация закреплённой версии](https://github.com/ggml-org/llama.cpp/blob/b12019/tools/server/README.md). Driver совместимость проверяется на настоящей машине, системный CUDA toolkit не предполагается установленным.

## Установка, запуск и остановка (PowerShell7)

На GPU-ПК клонировать эту ветку, выбрать постоянный диск с минимум9GiB свободно (лучше запас под оба кандидата). Не OneDrive/temp. Пример пути D:\BetweenModels менять под фактический диск:
deploy/model/Install-Model.ps1 -ModelRoot D:\BetweenModels -Profile gemma -GemmaTermsAccepted
deploy/model/Install-Model.ps1 -ModelRoot D:\BetweenModels -Profile qwen
Switch означает уже состоявшееся принятие условий владельцем. Installer проверяет nvidia-smi имя/VRAM/free/driver, archive+GGUF hashes, --help и CUDA --list-devices, сохраняет только hardware/install evidence. Это ещё не inference test.
deploy/model/Start-Model.ps1 -ModelRoot D:\BetweenModels -Profile gemma
В другом терминале: deploy/model/Stop-Model.ps1 -ModelRoot D:\BetweenModels.
Endpoint /v1/chat/completions, alias из lock. Два профиля не запускать одновременно. ctx4096, parallel1, batch128, initially24GPUlayers — осторожная гипотеза, НЕ full GPU claim. Глобальный n-predict1400; запросы берут task caps350/700/1400 из contracts. Общий budget учитывает template/system/input/output/reserve.
Во время benchmark запустить Measure-Model.ps1 -Samples 60 (hardware-only report, без inference). На реальной машине записать nvidia-smi до/во время/после серии, оставить минимум1536MiB Windows; если OOM — остановить, явно понизить ctx до3072/2048 или GPUlayers16/8. Повторить budget/quality/latency, не менять кандидата молча. Чистый CPU fallback не GPU verification.
Server использует --jinja --reasoning off --chat-template-kwargs enable_thinking=false, отключённые webui/agent/logs. Это параметры-кандидаты: фактический /props chat_template hash и /apply-template проверяет benchmark, ответы с reasoning/think/partial/finish length отвергаются. Qwen2507 instruct — non-thinking вариант; одного /no_think недостаточно. reasoning-format none не является выключением thinking.

## Воспроизводимое сравнение

Заполнить LOCAL_LLM_* приватно на машине измерения. Команда **расходует локальную GPU и делает генерации**, её запуск явный:
npm run model:check -- --allow-generation --profile gemma --vantage local --phase cold
После этого прогреть модель/считать первый запрос cold только сразу после отдельного restart, затем:
npm run model:check -- --allow-generation --profile gemma --vantage local --phase warm
Warm —24 одинаковых синтетических кейса (русский/отрицания/отказ/сарказм/цитаты/JSON/injection) из benchmark-cases.json, concurrency1, без auto retry. Повторить с qwen после stop/start и соответствующего alias. На QQCloud повторить --vantage qqcloud через private endpoint. Каждую cold серию предваряет явный restart; инструмент сам его не доказывает.
Измеряется первый content-token (не HTTP headers), полная SSE latency, p50/p95 отдельно phase/vantage, JSON/evidence/reasoning/finish/budget. .tools/model-<profile>-<phase>-<vantage>.json содержит только метрики, не ответы. Report expectedVersion/hash — ожидание; actual binary/install evidence проверяется на GPU-ПК.
Quality review обязателен в пользовательском интерфейсе на этих же synthetic кейсах: сохранённые отрицания/границы, осторожность трактовок, точность evidence/JSON, полезность русского ответа. Не писать ответы в логи benchmark. Отдельно записать pass/fail rubric по ID, prompt version, template hash, измеренный полный учебный цикл. Schema pass не semantic quality. Выбор модели selection=null до этого.
Цель warm short без очереди ≤5s проверять по коротким clarify кейсам отдельно, сложный JSON не обрезать ради цифры. Cold/relay/queued не смешивать с этой целью.

## Закрытая сеть

Владелец сначала проверяет [Tailscale terms](https://tailscale.com/terms), [privacy](https://tailscale.com/privacy-policy) и применимость плана/метаданных к проекту; это не inference provider, но отдельный сервис координации. Если условия не подходят — WireGuard после отдельного изменения env URL policy (сейчас production принимает numeric Tailnet100.64/10).
Добавление двух устройств/выдачу ключей делает владелец. Применить минимальную policy deploy/tailscale-policy.json, заменить admin tagOwners подтверждённым владельцем. Не оставлять default allow-all. Только coach-bot→coach-llm tcp8080; никакого Funnel/публичного роутера.
На GPU-ПК admin: Set-ModelFirewall.ps1 -ModelRoot D:\BetweenModels -HomeTailscaleIp <actual-home-IP> -CloudTailscaleIp <actual-cloud-IP>. Только точное локальное IP+cloud remoteIP+exe+port, defaultBlock и firewall остаются включены; broad existing allow rules блокируют setup для ручного разбора.
Start-Model с -BindAddress <actual-home-IP> -CloudTailscaleIp <actual-cloud-IP>. Не 0.0.0.0. endpoint.key получает ACL владельца/SYSTEM, передаётся облаку приватно, не Git/чат/argv. Ключ дополняет ACL/firewall.
Проверить tailscale ping cloud→home: direct или DERP(relay); записать режим/RTT, затем end-to-end benchmark (RTT не latency модели). Разрешённый cloud доступен; третий узел/LAN/публичный IP не имеют доступа. После disconnect/reconnect и reboot проверить заново; выключенный ПК → понятный failed run, чтение истории работает. Все эти проверки пока заблокированы доступом к двум узлам.
