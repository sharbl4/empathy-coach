# API · contracts 0.1.0

Источник истины: packages/contracts. Все объекты strict, неизвестные поля body отклоняются.
Auth только через Supabase SDK; все маршруты кроме health требуют Bearer.
UUID path params; никакого ownerId/userId/истории роли/готового анализа от клиента.

AI POST: Idempotency-Key UUID + expectedRevision; 202 RunAccepted. Create session: 201. Deletes: 204 без body (fixture null обозначает отсутствие JSON). Остальные успехи 200.
Polling GET /api/runs/:id раз в 1–2 секунды, остановить при уходе. Resume из SessionDetail.runs.
Старый ключ возвращает прежний run, изменённый payload → 409. Failed roleplay retry: только POST /api/runs/:id/retry с новым ключом; body expectedRevision, без повторной реплики.
Revision изменяется только при изменении входных данных. Все результаты относятся к sessionId+revision.
История: cursor непрозрачный, limit 1..50 (default 20), q до 200; updatedAt DESC,id DESC. nextCursor=null означает конец.

Ошибки HTTP: 400 VALIDATION_ERROR; 401 UNAUTHORIZED; 404 NOT_FOUND (включая чужой объект); 409 REVISION_CONFLICT / OPERATION_IN_PROGRESS / IDEMPOTENCY_CONFLICT; 429 RATE_LIMITED; 503 DEPENDENCY_UNAVAILABLE; 500 INTERNAL_ERROR.
Форма: {error:{code,message,requestId}}. Failed run errorCode: RUN_INTERRUPTED / MODEL_TIMEOUT / MODEL_UNAVAILABLE / MODEL_INVALID_OUTPUT / MODEL_REFUSED / CONFIGURATION_ERROR. Сырые ответы и stack trace запрещены.
Семантика зависимостей, concurrency, удаления и retry: architecture.md.

## GET /api/health/live

Ответ:

<!-- schema:live.response -->
```json
{
  "status": "ok"
}
```

## GET /api/health/ready

Ответ:

<!-- schema:ready.response -->
```json
{
  "status": "ok"
}
```

## GET /api/me

Ответ:

<!-- schema:me.response -->
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "displayName": "Антон",
  "onboardingCompletedAt": null,
  "aiMode": "gigachat",
  "capabilities": {
    "analysis": true,
    "reply": true,
    "exercise": true,
    "roleplay": true
  }
}
```

## PATCH /api/me

Запрос:

<!-- schema:updateMe.body -->
```json
{
  "displayName": "Антон",
  "onboardingCompleted": true
}
```

Ответ:

<!-- schema:updateMe.response -->
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "displayName": "Антон",
  "onboardingCompletedAt": null,
  "aiMode": "gigachat",
  "capabilities": {
    "analysis": true,
    "reply": true,
    "exercise": true,
    "roleplay": true
  }
}
```

## DELETE /api/me/data

Запрос:

<!-- schema:deleteData.body -->
```json
{
  "confirmation": "DELETE_MY_LEARNING_DATA"
}
```

Ответ:

<!-- schema:deleteData.response -->
```json
null
```

## POST /api/sessions

Запрос:

<!-- schema:createSession.body -->
```json
{
  "title": "Встреча",
  "situation": {
    "message": "Давай поговорим завтра.",
    "relationship": "Коллега",
    "context": "Обсуждали встречу",
    "goal": "clarify"
  },
  "guess": {
    "emotions": [],
    "evidenceQuotes": [
      "завтра"
    ],
    "unsure": true
  }
}
```

Ответ:

<!-- schema:createSession.response -->
```json
{
  "title": "Встреча",
  "situation": {
    "message": "Давай поговорим завтра.",
    "relationship": "Коллега",
    "context": "Обсуждали встречу",
    "goal": "clarify"
  },
  "guess": {
    "emotions": [],
    "evidenceQuotes": [
      "завтра"
    ],
    "unsure": true
  },
  "id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "createdAt": "2026-10-30T06:00:00.000Z",
  "updatedAt": "2026-10-30T06:00:00.000Z"
}
```

## GET /api/sessions

Ответ:

<!-- schema:sessions.response -->
```json
{
  "items": [
    {
      "title": "Встреча",
      "situation": {
        "message": "Давай поговорим завтра.",
        "relationship": "Коллега",
        "context": "Обсуждали встречу",
        "goal": "clarify"
      },
      "guess": {
        "emotions": [],
        "evidenceQuotes": [
          "завтра"
        ],
        "unsure": true
      },
      "id": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

## GET /api/sessions/:id

Ответ:

<!-- schema:session.response -->
```json
{
  "title": "Встреча",
  "situation": {
    "message": "Давай поговорим завтра.",
    "relationship": "Коллега",
    "context": "Обсуждали встречу",
    "goal": "clarify"
  },
  "guess": {
    "emotions": [],
    "evidenceQuotes": [
      "завтра"
    ],
    "unsure": true
  },
  "id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "createdAt": "2026-10-30T06:00:00.000Z",
  "updatedAt": "2026-10-30T06:00:00.000Z",
  "runs": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "analysis",
      "status": "succeeded",
      "output": {
        "literalMeaning": "Предлагается поговорить завтра.",
        "interpretations": [
          {
            "emotion": "Нейтральность",
            "possibleNeed": "Удобное время",
            "explanation": "Возможно, сейчас неудобно.",
            "evidenceQuotes": [
              "завтра"
            ]
          },
          {
            "emotion": "Усталость",
            "possibleNeed": "Отдых",
            "explanation": "Это лишь одна из гипотез.",
            "evidenceQuotes": []
          }
        ],
        "uncertainty": "Без контекста нельзя знать причину.",
        "clarifyingQuestion": "Во сколько завтра удобно?",
        "guessFeedback": "Неопределённость уместна.",
        "skillTip": "Уточняйте время."
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "reply_feedback",
      "status": "succeeded",
      "output": {
        "strengths": [
          "Есть уточнение."
        ],
        "phraseFeedback": [
          {
            "quote": "Во сколько?",
            "possibleImpact": "Может звучать кратко.",
            "suggestion": "Добавьте удобство собеседника."
          }
        ],
        "revisedReply": "Во сколько завтра тебе удобно?",
        "options": [
          {
            "goal": "support",
            "text": "Давай обсудим завтра. Во сколько удобно?",
            "explanation": "Учитывает цель и оставляет пространство для ответа."
          },
          {
            "goal": "clarify",
            "text": "Давай обсудим завтра. Во сколько удобно?",
            "explanation": "Учитывает цель и оставляет пространство для ответа."
          },
          {
            "goal": "reconcile",
            "text": "Давай обсудим завтра. Во сколько удобно?",
            "explanation": "Учитывает цель и оставляет пространство для ответа."
          },
          {
            "goal": "boundary",
            "text": "Давай обсудим завтра. Во сколько удобно?",
            "explanation": "Учитывает цель и оставляет пространство для ответа."
          }
        ]
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "reply_examples",
      "status": "succeeded",
      "output": [
        {
          "goal": "support",
          "text": "Давай обсудим завтра. Во сколько удобно?",
          "explanation": "Учитывает цель и оставляет пространство для ответа."
        },
        {
          "goal": "clarify",
          "text": "Давай обсудим завтра. Во сколько удобно?",
          "explanation": "Учитывает цель и оставляет пространство для ответа."
        },
        {
          "goal": "reconcile",
          "text": "Давай обсудим завтра. Во сколько удобно?",
          "explanation": "Учитывает цель и оставляет пространство для ответа."
        },
        {
          "goal": "boundary",
          "text": "Давай обсудим завтра. Во сколько удобно?",
          "explanation": "Учитывает цель и оставляет пространство для ответа."
        }
      ],
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "exercise",
      "status": "succeeded",
      "output": {
        "instruction": "За 30–60 секунд задайте один уточняющий вопрос.",
        "skill": "Уточнение",
        "exampleHint": "Спросите о времени."
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "exercise_feedback",
      "status": "succeeded",
      "output": {
        "strengths": [
          "Вопрос конкретный."
        ],
        "improvement": "Оставьте возможность предложить другое время.",
        "suggestedAttempt": "Во сколько тебе удобно?"
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "roleplay_start",
      "status": "succeeded",
      "output": {
        "kind": "message",
        "content": "Давай завтра вечером?"
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "roleplay_turn",
      "status": "succeeded",
      "output": {
        "kind": "message",
        "content": "В семь мне удобно."
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "roleplay_feedback",
      "status": "succeeded",
      "output": {
        "kind": "feedback",
        "strengths": [
          "Вы уточнили время."
        ],
        "improvements": [
          "Можно сверить договорённость."
        ],
        "nextPractice": "Кратко подведите итог."
      },
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "analysis",
      "status": "pending",
      "output": null,
      "errorCode": null
    },
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "createdAt": "2026-10-30T06:00:00.000Z",
      "updatedAt": "2026-10-30T06:00:00.000Z",
      "kind": "analysis",
      "status": "failed",
      "output": null,
      "errorCode": "RUN_INTERRUPTED"
    }
  ],
  "roleplays": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "sessionId": "11111111-1111-4111-8111-111111111111",
      "revision": 1,
      "status": "active",
      "turnCount": 0,
      "messages": [
        {
          "id": "11111111-1111-4111-8111-111111111111",
          "sequence": 0,
          "role": "assistant",
          "content": "Давай завтра вечером?"
        }
      ],
      "feedback": null
    }
  ]
}
```

## PATCH /api/sessions/:id

Запрос:

<!-- schema:updateSession.body -->
```json
{
  "title": "Встреча",
  "situation": {
    "message": "Давай поговорим завтра.",
    "relationship": "Коллега",
    "context": "Обсуждали встречу",
    "goal": "clarify"
  },
  "guess": {
    "emotions": [],
    "evidenceQuotes": [
      "завтра"
    ],
    "unsure": true
  },
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:updateSession.response -->
```json
{
  "title": "Встреча",
  "situation": {
    "message": "Давай поговорим завтра.",
    "relationship": "Коллега",
    "context": "Обсуждали встречу",
    "goal": "clarify"
  },
  "guess": {
    "emotions": [],
    "evidenceQuotes": [
      "завтра"
    ],
    "unsure": true
  },
  "id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "createdAt": "2026-10-30T06:00:00.000Z",
  "updatedAt": "2026-10-30T06:00:00.000Z"
}
```

## DELETE /api/sessions/:id

Ответ:

<!-- schema:deleteSession.response -->
```json
null
```

## POST /api/sessions/:id/analyze

Запрос:

<!-- schema:analyze.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:analyze.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/sessions/:id/reply-feedback

Запрос:

<!-- schema:replyFeedback.body -->
```json
{
  "expectedRevision": 1,
  "draft": "Во сколько?"
}
```

Ответ:

<!-- schema:replyFeedback.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/sessions/:id/reply-examples

Запрос:

<!-- schema:replyExamples.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:replyExamples.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/sessions/:id/exercise

Запрос:

<!-- schema:exercise.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:exercise.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/sessions/:id/exercise-feedback

Запрос:

<!-- schema:exerciseFeedback.body -->
```json
{
  "expectedRevision": 1,
  "exerciseRunId": "11111111-1111-4111-8111-111111111111",
  "answer": "Во сколько тебе удобно?"
}
```

Ответ:

<!-- schema:exerciseFeedback.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/sessions/:id/roleplays

Запрос:

<!-- schema:roleplayStart.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:roleplayStart.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111",
  "resourceId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/roleplays/:id/turns

Запрос:

<!-- schema:roleplayTurn.body -->
```json
{
  "expectedRevision": 1,
  "content": "В семь?"
}
```

Ответ:

<!-- schema:roleplayTurn.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/roleplays/:id/finish

Запрос:

<!-- schema:roleplayFinish.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:roleplayFinish.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## POST /api/runs/:id/retry

Запрос:

<!-- schema:retry.body -->
```json
{
  "expectedRevision": 1
}
```

Ответ:

<!-- schema:retry.response -->
```json
{
  "runId": "11111111-1111-4111-8111-111111111111"
}
```

## GET /api/runs/:id

Ответ:

<!-- schema:run.response -->
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "createdAt": "2026-10-30T06:00:00.000Z",
  "updatedAt": "2026-10-30T06:00:00.000Z",
  "kind": "analysis",
  "status": "succeeded",
  "output": {
    "literalMeaning": "Предлагается поговорить завтра.",
    "interpretations": [
      {
        "emotion": "Нейтральность",
        "possibleNeed": "Удобное время",
        "explanation": "Возможно, сейчас неудобно.",
        "evidenceQuotes": [
          "завтра"
        ]
      },
      {
        "emotion": "Усталость",
        "possibleNeed": "Отдых",
        "explanation": "Это лишь одна из гипотез.",
        "evidenceQuotes": []
      }
    ],
    "uncertainty": "Без контекста нельзя знать причину.",
    "clarifyingQuestion": "Во сколько завтра удобно?",
    "guessFeedback": "Неопределённость уместна.",
    "skillTip": "Уточняйте время."
  },
  "errorCode": null
}
```

## GET /api/progress

Ответ:

<!-- schema:progress.response -->
```json
{
  "analyzedSessions": 1,
  "completedExercises": 1,
  "completedRoleplays": 1,
  "skills": [
    {
      "skill": "Уточнение",
      "count": 3
    }
  ],
  "latestTip": "Уточняйте время."
}
```
