# Review backend a2bb682 → fabed23 и interfaces f12d309

Проверены реальные remote heads на01.11.2026: PR23/backend `fabed230db9a139e8ff46a5a788ab852fa87eea2` уже содержит перенос a2bb682 с2.1 на2.2; ждать предполагаемые1–2часа больше не требовалось. PR22/interfaces `f12d309e1d5ebe41f4344a3c7fcf5490c7b28556` содержит2.2. Текст старого PR report не использован как доказательство. На этих heads CI индивидуальных PR красный: PR22 contracts/web зелёные, integration красный; PR23 contracts зелёный, web/integration красные. Частичные ветки по отдельности не являются общим продуктом.

Собраны clean merges поверх436d17b в отдельной `test/stack-a1-nov01`, затем контракт9cd742f и integration fixes6755408. Не использовались незакоммиченные backend-заглушки. Официальные PR не слиты/не закрыты, #17/#19 тоже сохранены: полного equivalence старых сценариев и live ещё нет. Командных сообщений, issues и комментариев PR не отправлено.

| Решение | Было в2.2 | Минимальное2.2.1 / реализация |
|---|---|---|
| Незавершённый тест | canonical assessment answers/version/revision, но menu с таким nav невалиден | menu допускает тот же nav; optional reset confirmation; domain guard и UI continue/confirm discard |
| Собственная оценка | rateRun upsert есть; Run DTO не читает vote | optional myRating в общем RunV2; backend всегда выдаёт null/value из owned vote; web восстанавливает |
| run_completed | успешный finish уже атомарно вызывает learning.completed; event unique есть | убрать из client StageEvent, оставить полный enum для domain/analytics; invalid result не пишет успех |
| Правка ветки | ordered turns со стабильным id и ComposerDraft/updateSession достаточны | нового DTO нет; Telegram добавлены edit/up/down, сохранение выбранного turn через domain navigation |

В найденных production UI дефектах: PreviewPage не сохранял shown snapshot в domain navigation, поэтому edit/confirm отвергались PREVIEW_STALE; compose effect терял save, если dialogue загружался после ввода, и не отменял debounce при submit. Исправлены точечными адаптерными изменениями с revision conflicts, без fetch-and-confirm чужой новой версии. После edit сохраняется новый shown hash до включения send/save.

В тестах: «fresh tab» был same-document hash-only goto в прежней вкладке, bootstrap не запускался; создана действительно новая вкладка. Shared logout assertion запускался до завершения mutation — добавлено ожидание страницы входа. Assertions не удалялись. При повторном полном e2e прошлый synthetic assessment оставался в test DB и корректно блокировал новый сценарий; suite setup теперь явно сбрасывает только два synthetic dialogue через домен с confirmation. Login никогда их не сбрасывает, persistence проверяется reload/navigation. Не отключены production guard, CSRF, ownership или TTL.

## Проверки и границы доказательств

- Node24.22.1, PostgreSQL17.6-bookworm, отдельный loopback контейнер/две БД, пользовательский .env не загружался и не менялся.
- build, typecheck, lint; свежие миграции;43 contracts/root,88 domain/HTTP/bot (в том числе real lifecycle),13 Playwright passed,0skipped. Legacy suite56passed/0skipped частично пересекается с основным набором.
- Browser: Playwright1.56.1 + установленный Chrome157.0.8103.26, новый профиль; bundled Chromium download был недоступен практически по скорости. CI использует bundled Chromium, channel override только явный локальный chrome/msedge. Trace/video/screenshots выключены; reporter не печатает auth URLs/cookies/raw error.
- Дополнены существующие13 сценариев: после настоящего test-model run vote→reload→change→reload; assessment→menu navigation→return→cancel discard→confirm discard. Unit bot проверяет edit/reorder/restart и menu/resume/discard. Model/mail/Telegram seams явно test-only; реальный GPU/SMTP/Telegram не вызывались.
- Real lifecycle связывает один domain с HTTP; настоящий DB/worker scheduler, test-only no-network Telegram. Проверены ready, concurrent double close, закрытый HTTP port, удалённый heartbeat и освобождённый advisory lease. Root partial-failure/deadline тесты остаются отдельно с явными factories.
- Production Docker image собран, `--network none` import `@between/api`, `/http`, `@between/bot` завершается без запуска серверов. Runtime Supabase package отсутствует. npm сообщает3moderate runtime advisories; зависимости не обновлялись через force, отдельный dependency review остаётся.
- Один общий88-run дал1fail со скрытым прежним reporter именем; отдельный negative-model test и два последовательных диагностических повтора88/88 успешны. Причина того сбоя не установлена. Safe runner теперь выводит статические имена failures. Это остаточный риск, а не доказанное исправление.

CI опубликованного code candidate: https://github.com/sharbl4/empathy-coach/actions/runs/41233504509 — статус фиксировать по фактическому завершению, а не локальным тестам. Полный раздел7, два настоящих пользователя, Telegram→QQCloud→Windows→web, SMTP workflow, offline/reconnect, облачные RAM/VRAM/TTFT/p50/p95 не приняты. FEATURES-27 и зелёные тестовые adapters не заменяют эти gates. Задания/доступы —в [handoff](handoff-v2.md).
