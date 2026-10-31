# Generated facade 2.2.1

Source: packages/contracts/src/product.ts and http.ts. Regenerate: npm run build -w @between/contracts; node scripts/generate-product-contract.mjs. Semantic rules: contract-v2.2.md; earlier v2/A1 docs are historical where superseded. This is the complete mandatory scope, not a claim of implementation.

## All section7 features

| Feature | Shared facade | AI preview kind |
|---|---|---|
| 1. Аккаунт | account, requestEmailCode, emailVerification, resendEmailCode, verifyEmailCode; internal/auth: issueWebLink, redeemWebLink, revokeAllWebSessions | — |
| 2. Онбординг | acceptConsent, updateAccount, dialogue | — |
| 3. Примеры | examples, example, createSession, createPreview, startRun | — |
| 4. Понять сообщение | createSession, createPreview, confirmPreview, startRun | analysis |
| 5. Своя гипотеза | createSession, updateSession | analysis |
| 6. Основания | run | analysis |
| 7. Сказать прямо | createSession, createPreview, startRun | say_direct |
| 8. До отправки | createSession, createPreview, startRun | before_send |
| 9. Разбор фраз | createPreview, startRun | reply_feedback, before_send |
| 10. Цели ответа | createPreview, startRun | reply_examples, reply_feedback |
| 11. Скрытие данных | createPreview, preview, editPreview, confirmPreview | — |
| 12. Ветка переписки | createSession, updateSession, createPreview | — |
| 13. Контексты | createSession, updateSession, sessions, examples | — |
| 14. Упражнение | createPreview, startRun | exercise, exercise_feedback |
| 15. Ролевая игра | createPreview, startRun, roleplay, roleplays | roleplay_start, roleplay_turn, roleplay_feedback |
| 16. Практика дня | dailyPractice, completeDailyPractice | — |
| 17. Напоминания | reminders, updateReminders; internal/auth: claimDeliveries, completeDelivery, failDelivery | — |
| 18. Стрики | progress, completeDailyPractice | — |
| 19. Навыки | progress, skillAttempts | — |
| 20. Карточки | cards, card, completeCard, createPreview, startRun | card_feedback |
| 21. До/после | assessment, submitAssessment, assessmentResults | — |
| 22. История | sessions, session, runs, roleplays, run, dialogue, updateDialogue | — |
| 23. Прогресс | progress | — |
| 24. Полезность | rateRun | — |
| 25. Аналитика | recordStage; internal/auth: operationalAnalytics | — |
| 26. Сложные ситуации | supportRegion, updateSupportRegion, support | — |
| 27. Удаление | deleteSession, deleteData, deleteAccount | — |

## Exact user method signatures

OperationInput/OperationOutput infer the strict Zod input/response from operations; do not copy DTOs into transports. Every mutable key is a UUID IntentKey, domain validates it.

```ts
account(ctx: UserContext, input: OperationInput<'account'>): Promise<OperationOutput<'account'>>;
updateAccount(ctx: UserContext, input: OperationInput<'updateAccount'>, key: string): Promise<OperationOutput<'updateAccount'>>;
acceptConsent(ctx: UserContext, input: OperationInput<'acceptConsent'>, key: string): Promise<OperationOutput<'acceptConsent'>>;
revokeConsent(ctx: UserContext, input: OperationInput<'revokeConsent'>, key: string): Promise<OperationOutput<'revokeConsent'>>;
emailVerification(ctx: UserContext, input: OperationInput<'emailVerification'>): Promise<OperationOutput<'emailVerification'>>;
requestEmailCode(ctx: UserContext, input: OperationInput<'requestEmailCode'>, key: string): Promise<OperationOutput<'requestEmailCode'>>;
resendEmailCode(ctx: UserContext, input: OperationInput<'resendEmailCode'>, key: string): Promise<OperationOutput<'resendEmailCode'>>;
verifyEmailCode(ctx: UserContext, input: OperationInput<'verifyEmailCode'>, key: string): Promise<OperationOutput<'verifyEmailCode'>>;
dialogue(ctx: UserContext, input: OperationInput<'dialogue'>): Promise<OperationOutput<'dialogue'>>;
updateDialogue(ctx: UserContext, input: OperationInput<'updateDialogue'>, key: string): Promise<OperationOutput<'updateDialogue'>>;
resetDialogue(ctx: UserContext, input: OperationInput<'resetDialogue'>, key: string): Promise<OperationOutput<'resetDialogue'>>;
createSession(ctx: UserContext, input: OperationInput<'createSession'>, key: string): Promise<OperationOutput<'createSession'>>;
sessions(ctx: UserContext, input: OperationInput<'sessions'>): Promise<OperationOutput<'sessions'>>;
session(ctx: UserContext, input: OperationInput<'session'>): Promise<OperationOutput<'session'>>;
updateSession(ctx: UserContext, input: OperationInput<'updateSession'>, key: string): Promise<OperationOutput<'updateSession'>>;
deleteSession(ctx: UserContext, input: OperationInput<'deleteSession'>, key: string): Promise<OperationOutput<'deleteSession'>>;
deleteData(ctx: UserContext, input: OperationInput<'deleteData'>, key: string): Promise<OperationOutput<'deleteData'>>;
deleteAccount(ctx: UserContext, input: OperationInput<'deleteAccount'>, key: string): Promise<OperationOutput<'deleteAccount'>>;
createPreview(ctx: UserContext, input: OperationInput<'createPreview'>, key: string): Promise<OperationOutput<'createPreview'>>;
preview(ctx: UserContext, input: OperationInput<'preview'>): Promise<OperationOutput<'preview'>>;
editPreview(ctx: UserContext, input: OperationInput<'editPreview'>, key: string): Promise<OperationOutput<'editPreview'>>;
confirmPreview(ctx: UserContext, input: OperationInput<'confirmPreview'>, key: string): Promise<OperationOutput<'confirmPreview'>>;
startRun(ctx: UserContext, input: OperationInput<'startRun'>, key: string): Promise<OperationOutput<'startRun'>>;
run(ctx: UserContext, input: OperationInput<'run'>): Promise<OperationOutput<'run'>>;
retry(ctx: UserContext, input: OperationInput<'retry'>, key: string): Promise<OperationOutput<'retry'>>;
runs(ctx: UserContext, input: OperationInput<'runs'>): Promise<OperationOutput<'runs'>>;
roleplays(ctx: UserContext, input: OperationInput<'roleplays'>): Promise<OperationOutput<'roleplays'>>;
roleplay(ctx: UserContext, input: OperationInput<'roleplay'>): Promise<OperationOutput<'roleplay'>>;
examples(ctx: UserContext, input: OperationInput<'examples'>): Promise<OperationOutput<'examples'>>;
example(ctx: UserContext, input: OperationInput<'example'>): Promise<OperationOutput<'example'>>;
progress(ctx: UserContext, input: OperationInput<'progress'>): Promise<OperationOutput<'progress'>>;
skillAttempts(ctx: UserContext, input: OperationInput<'skillAttempts'>): Promise<OperationOutput<'skillAttempts'>>;
dailyPractice(ctx: UserContext, input: OperationInput<'dailyPractice'>): Promise<OperationOutput<'dailyPractice'>>;
completeDailyPractice(ctx: UserContext, input: OperationInput<'completeDailyPractice'>, key: string): Promise<OperationOutput<'completeDailyPractice'>>;
cards(ctx: UserContext, input: OperationInput<'cards'>): Promise<OperationOutput<'cards'>>;
card(ctx: UserContext, input: OperationInput<'card'>): Promise<OperationOutput<'card'>>;
completeCard(ctx: UserContext, input: OperationInput<'completeCard'>, key: string): Promise<OperationOutput<'completeCard'>>;
reminders(ctx: UserContext, input: OperationInput<'reminders'>): Promise<OperationOutput<'reminders'>>;
updateReminders(ctx: UserContext, input: OperationInput<'updateReminders'>, key: string): Promise<OperationOutput<'updateReminders'>>;
assessment(ctx: UserContext, input: OperationInput<'assessment'>): Promise<OperationOutput<'assessment'>>;
submitAssessment(ctx: UserContext, input: OperationInput<'submitAssessment'>, key: string): Promise<OperationOutput<'submitAssessment'>>;
assessmentResults(ctx: UserContext, input: OperationInput<'assessmentResults'>): Promise<OperationOutput<'assessmentResults'>>;
rateRun(ctx: UserContext, input: OperationInput<'rateRun'>, key: string): Promise<OperationOutput<'rateRun'>>;
recordStage(ctx: UserContext, input: OperationInput<'recordStage'>, key: string): Promise<OperationOutput<'recordStage'>>;
supportRegion(ctx: UserContext, input: OperationInput<'supportRegion'>): Promise<OperationOutput<'supportRegion'>>;
updateSupportRegion(ctx: UserContext, input: OperationInput<'updateSupportRegion'>, key: string): Promise<OperationOutput<'updateSupportRegion'>>;
support(ctx: UserContext, input: OperationInput<'support'>): Promise<OperationOutput<'support'>>;
```

## Internal/auth lifecycle signatures

Only the root creates the domain and calls start once; operator analytics is never a user route. BrowserAccess/ConsumedWebLink contain private cookie material and cannot be serialized.

```ts
readonly shutdownSignal:AbortSignal;
start():Promise<void>;
stopAccepting():Promise<void>;
close():Promise<void>;
acquirePollerLease(botId:string):Promise<PollerLease>;
resolveUser(identity:z.infer<typeof PrivateTelegramIdentity>):Promise<UserContext>;
resolveWebSession(serverCookieToken:string):Promise<UserContext>;
openBrowser(serverBindingCookieToken?:string,serverSessionCookieToken?:string):Promise<BrowserAccess>;
authorizeWebMutation(browser:BrowserContext,input:z.infer<typeof WebMutationProof>):Promise<void>;
webEntry():Promise<z.infer<typeof WebEntry>>;
issueWebLink(ctx:UserContext,key:string):Promise<z.infer<typeof IssuedWebLink>>;
redeemWebLink(browser:BrowserContext,input:z.infer<typeof RedeemWebLink>,key:string):Promise<ConsumedWebLink>;
webSessions(ctx:UserContext,input:z.infer<typeof PageQuery>):Promise<z.infer<typeof WebSessionPage>>;
revokeWebSession(ctx:UserContext,id:string,key:string):Promise<void>;
revokeCurrentWebSession(ctx:UserContext,key:string):Promise<void>;
revokeAllWebSessions(ctx:UserContext,key:string):Promise<void>;
updateCursor():Promise<z.infer<typeof UpdateCursor>>;
claimUpdate(ctx:UserContext,updateId:string):Promise<z.infer<typeof UpdateReceiptV2>>;
recordUpdateFailure(ctx:UserContext,input:z.infer<typeof UpdateFailure>,key:string):Promise<z.infer<typeof UpdateReceiptV2>>;
acknowledgeUpdate(updateId:string):Promise<void>;
claimDeliveries(limit:number):Promise<Delivery[]>;
completeDelivery(ctx:UserContext,id:string):Promise<void>;
failDelivery(ctx:UserContext,id:string,input:z.infer<typeof DeliveryFailure>):Promise<void>;
operationalAnalytics(input:z.infer<typeof AnalyticsWindow>):Promise<z.infer<typeof OperationalAnalytics>>;
health():Promise<{database:boolean;workers:boolean;scheduler:boolean;pollerLease:boolean}>;
```

## User HTTP bindings

| Endpoint | Facade | Security |
|---|---|---|
| GET /api/account | account | session read |
| PATCH /api/account | updateAccount | Origin + CSRF + intent |
| POST /api/account/consent | acceptConsent | Origin + CSRF + intent |
| DELETE /api/account/consent | revokeConsent | Origin + CSRF + intent |
| GET /api/account/email/verification | emailVerification | session read |
| POST /api/account/email/challenge | requestEmailCode | Origin + CSRF + intent |
| POST /api/account/email/resend | resendEmailCode | Origin + CSRF + intent |
| POST /api/account/email/verify | verifyEmailCode | Origin + CSRF + intent |
| GET /api/dialogue | dialogue | session read |
| PATCH /api/dialogue | updateDialogue | Origin + CSRF + intent |
| POST /api/dialogue/reset | resetDialogue | Origin + CSRF + intent |
| POST /api/sessions | createSession | Origin + CSRF + intent |
| GET /api/sessions | sessions | session read |
| GET /api/sessions/:id | session | session read |
| PATCH /api/sessions/:id | updateSession | Origin + CSRF + intent |
| DELETE /api/sessions/:id | deleteSession | Origin + CSRF + intent |
| DELETE /api/account/data | deleteData | Origin + CSRF + intent |
| DELETE /api/account | deleteAccount | Origin + CSRF + intent |
| POST /api/previews | createPreview | Origin + CSRF + intent |
| GET /api/previews/:id | preview | session read |
| PATCH /api/previews/:id | editPreview | Origin + CSRF + intent |
| POST /api/previews/:id/confirm | confirmPreview | Origin + CSRF + intent |
| POST /api/runs | startRun | Origin + CSRF + intent |
| GET /api/runs/:id | run | session read |
| POST /api/runs/:id/retry | retry | Origin + CSRF + intent |
| GET /api/sessions/:sessionId/runs | runs | session read |
| GET /api/sessions/:sessionId/roleplays | roleplays | session read |
| GET /api/roleplays/:id | roleplay | session read |
| GET /api/examples | examples | session read |
| GET /api/examples/:id | example | session read |
| GET /api/progress | progress | session read |
| GET /api/progress/attempts | skillAttempts | session read |
| GET /api/practice/today | dailyPractice | session read |
| POST /api/practice/complete | completeDailyPractice | Origin + CSRF + intent |
| GET /api/cards | cards | session read |
| GET /api/cards/:id | card | session read |
| POST /api/cards/:id/complete | completeCard | Origin + CSRF + intent |
| GET /api/reminders | reminders | session read |
| PATCH /api/reminders | updateReminders | Origin + CSRF + intent |
| GET /api/assessments/form | assessment | session read |
| POST /api/assessments/:id/submit | submitAssessment | Origin + CSRF + intent |
| GET /api/assessments/results | assessmentResults | session read |
| POST /api/runs/:runId/rating | rateRun | Origin + CSRF + intent |
| POST /api/events | recordStage | Origin + CSRF + intent |
| GET /api/support/region | supportRegion | session read |
| PATCH /api/support/region | updateSupportRegion | Origin + CSRF + intent |
| GET /api/support | support | session read |

## Auth HTTP bindings

| Endpoint | Facade | Session | Security |
|---|---|---|---|
| GET /api/auth/session | openBrowser | optional | read |
| GET /api/auth/entry | webEntry | none | read |
| POST /api/auth/web-links/redeem | redeemWebLink | browser-binding | Origin + CSRF + intent |
| POST /api/auth/logout | revokeCurrentWebSession | required | Origin + CSRF + intent |
| GET /api/auth/sessions | webSessions | required | read |
| DELETE /api/auth/sessions/:id | revokeWebSession | required | Origin + CSRF + intent |
| DELETE /api/auth/sessions | revokeAllWebSessions | required | Origin + CSRF + intent |
