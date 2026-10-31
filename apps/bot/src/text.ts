import type {z} from 'zod';
import type {AnalysisV2,AssessmentForm,AssessmentResult,Card,ContextType,Difficulty,DirectV2,DraftFeedback,Feedback,FourGoals,Goal,LearningMode,Practice,Preview,ProgressV2,ReminderSettings,RoleFeedback,SkillAttempt,Skill,Support} from '@between/contracts/product';

type I<S extends z.ZodType>=z.infer<S>;
// All bot messages are plain text (no parse_mode): user and model text needs no escaping.
export const TELEGRAM_LIMIT=4096;
const CHUNK=3500;

/** Split on paragraph, then line, then word boundaries, keeping a margin below the Telegram limit. */
export function chunk(text:string,size=CHUNK):string[] {
  const parts:string[]=[];let rest=text.trim();
  while(rest.length>size){
    const window=rest.slice(0,size);
    let cut=window.lastIndexOf('\n\n');
    if(cut<size/3)cut=window.lastIndexOf('\n');
    if(cut<size/3)cut=window.lastIndexOf(' ');
    if(cut<size/3)cut=size;
    parts.push(rest.slice(0,cut).trimEnd());rest=rest.slice(cut).trimStart();
  }
  if(rest)parts.push(rest);
  return parts;
}

// Mirrors the Zod limits of @between/contracts/product for user-facing hints.
export const limits={message:6000,draft:6000,intent:1000,relationship:200,context:4000,text:3000,emotion:100,emotions:3,quotes:3,turns:20,title:200} as const;

export const goalLabels:Record<I<typeof Goal>,string>={support:'Поддержать',clarify:'Уточнить',reconcile:'Помириться',boundary:'Обозначить границу'};
export const contextLabels:Record<I<typeof ContextType>,string>={close:'Близкие',colleague:'Коллеги',teacher:'Преподаватель',client:'Клиент'};
export const difficultyLabels:Record<I<typeof Difficulty>,string>={calm:'Спокойный',hurt:'Обиженный',irritated:'Раздражённый'};
export const modeLabels:Record<I<typeof LearningMode>,string>={understand:'Понять сообщение',say_direct:'Сказать прямо',before_send:'До отправки',thread:'Ветка переписки'};
export const skillLabels:Record<I<typeof Skill>,string>={clarification:'Уточнение',acknowledgment:'Признание переживания',request:'Ясная просьба',boundary:'Граница'};
const basisLabels={text:'есть текстовые основания',context:'зависит от контекста',insufficient:'данных недостаточно'} as const;
const toneLabels={good:'🟢 удачно',caution:'🟡 может прозвучать двояко',risky:'🟠 стоит пересмотреть'} as const;

const list=(items:string[])=>items.map(item=>`• ${item}`).join('\n');

export const texts={
  greeting:'Привет! Это «Между строк» — тренажёр понимания переписки.\n\nНесколько возможных трактовок. Мысли не читаем.\n\nТы присылаешь сообщение или свой черновик, сначала пробуешь сам, а потом видишь несколько возможных прочтений, что в тексте на них указывает и что остаётся неизвестным.',
  onboarding:'Перед началом:\n• Разбор — это гипотезы, а не правда о чувствах другого человека.\n• Перед каждой отправкой в модель ты увидишь точную копию текста: телефоны и почты скрываются автоматически, имена и адреса проверь сам. Это помощь, а не гарантия анонимности.\n• Тексты проходят через Telegram, хранятся на сервере проекта и обрабатываются моделью на компьютере команды, пока ты их не удалишь.\n\nНажимая «Принимаю», ты соглашаешься на обработку по политике проекта (редакция web-telegram-2, черновик). Затем подтвердим почту одноразовым кодом — пароль не нужен.',
  askEmail:'Напиши адрес почты, на который отправить код.',
  menu:'Главное меню. Что делаем?',
  help:'Команды:\n/menu — главное меню\n/cancel — отменить текущий шаг\n/history — сохранённые разборы\n/account — почта, веб-вход, напоминания, удаление данных\n/help — эта справка\n\n«Понять сообщение» — разбор чужого сообщения с твоей версией.\n«Сказать прямо» — сказать своё яснее, сохранив смысл, отказ и границы.\n«До отправки» — проверить свой черновик.\n«Ветка» — разобрать несколько реплик.',
  groupOnly:'Я работаю только в личном чате, чтобы сообщения из группы не попадали в разбор. Открой личный чат со мной.',
  stale:'Этот шаг уже завершён.',
  cancelled:'Текущий шаг отменён, черновик удалён.',
  needVerify:'Сначала подтверди почту — после этого откроются разборы и история.',
  needConsent:'Нужно согласие на обработку данных. Без него новые разборы недоступны; удалить данные можно в /account.',
  unknownInput:'Сейчас я жду нажатия кнопки. Черновик сохранён. /menu — главное меню, /cancel — отменить.',
  modelDown:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен). Меню, история, карточки и аккаунт работают. Попробуй повторить позже.',
  busy:'Предыдущий запрос ещё выполняется. Результат придёт сюда.',
  rateLimited:'Слишком много запросов. Попробуй повторить чуть позже.',
  conflict:'Данные изменились (например, в веб-версии). Открой актуальную версию из истории.',
  notFound:'Такой записи нет или она удалена.',
  internal:'Что-то пошло не так. Черновик сохранён, попробуй ещё раз.',
  textOnly:'Я понимаю только текст. Скопируй текст и пришли его. Черновик сохранён.',
  privacyHint:'Подсказка: убери имена и адреса. Телефоны и почты скроются автоматически, но проверь предпросмотр.',
  previewStale:'Предпросмотр устарел: данные или модель изменились. Создам новый — проверь его ещё раз.',
  tooLarge:'Текст не помещается в контекст модели. Сократи его — обрезать молча не будем.'
};

export const tooLong=(max:number,actual:number)=>`Слишком длинно: ${actual} символов, можно до ${max}. Сократи и пришли ещё раз — предыдущие шаги сохранены.`;
export const queued=(position:number|null|undefined)=>position?`Запрос принят. Место в очереди: ${position}. Ответ придёт отдельным сообщением.`:'Запрос принят. Ответ придёт отдельным сообщением.';

/** Exact masked snapshot from the domain; the user confirms this, not the raw draft. */
export function preview(p:I<typeof Preview>) {
  const order=new Map(p.turns.map(turn=>[turn.fieldId,turn]));
  const fields=p.fields.map((f,n)=>{const turn=order.get(f.id);const who=turn?(turn.speaker==='self'?' (я)':' (собеседник)'):'';return `${n+1}. ${f.label}${who}${f.editable?'':' · только чтение'}:\n${f.value||'—'}`;}).join('\n\n');
  const masked=p.redactionCount?`Автоматически скрыто телефонов/почт: ${p.redactionCount}.`:'Телефонов и почт не найдено.';
  const budget=p.budget.fit==='too_large'?`\n\n⚠️ ${texts.tooLarge}`:p.budget.fit==='unknown'?'\n\nРазмер для модели не удалось проверить заранее.':'';
  return `Так текст уйдёт в модель (проверь все поля):\n\n${fields}\n\n${masked} Имена и адреса проверь сам и при необходимости нажми «Изменить». Это помощь, а не гарантия анонимности.${budget}`;
}

export function analysis(a:I<typeof AnalysisV2>,fields:ReadonlyMap<string,string>=new Map()) {
  const quote=(fieldId:string,q:string)=>`«${q}»${fields.has(fieldId)?` — ${fields.get(fieldId)}`:''}`;
  const variants=a.interpretations.map((i,n)=>`${n+1}. ${i.emotion} → возможная потребность: ${i.possibleNeed}\nОснования: ${basisLabels[i.basis]}\n${i.explanation}\n${i.evidence.length?`Опора в тексте: ${i.evidence.map(e=>quote(e.fieldId,e.quote)).join(', ')}`:'Опора в тексте: прямых слов нет — это предположение.'}`).join('\n\n');
  const c=a.comparison;
  return `Буквально: ${a.literalMeaning}\n\nВозможные трактовки (гипотезы, а не факты; категории оснований — оценка модели, не вероятность чувства):\n\n${variants}\n\nЧто неизвестно: ${a.uncertainty}\n\nТвоя версия и другие версии\nГде совпало: ${c.matches.length?c.matches.join('; '):'явных совпадений нет — это нормально'}\nДругие возможные версии: ${c.alternatives.length?c.alternatives.join('; '):'—'}\nЧто уточнить: ${c.toClarify.length?c.toClarify.join('; '):'—'}\nСовпадение с разбором не означает «правильно» — это ещё одна гипотеза.\n\nСовет: ${a.skillTip}`;
}
export const clarify=(a:I<typeof AnalysisV2>)=>`Нейтральный уточняющий вопрос:\n«${a.clarifyingQuestion}»`;

export const options=(items:I<typeof FourGoals>)=>items.map(o=>`${goalLabels[o.goal]}:\n«${o.text}»\n${o.explanation}`).join('\n\n');

export function draftFeedback(f:I<typeof DraftFeedback>) {
  const phrases=f.phrases.map((p,n)=>`${n+1}. ${toneLabels[p.tone]}\n«${p.quote}»\nКак может прозвучать: ${p.why}\nВозможная замена: ${p.softer}`).join('\n\n');
  return [f.strengths.length?`Сильные стороны черновика:\n${list(f.strengths)}`:'',phrases?`Фразы (это возможное восприятие, не оценка тебя):\n\n${phrases}`:'',`Вариант доработки:\n«${f.revisedReply}»`,`Примеры под разные цели:\n\n${options(f.options)}`].filter(Boolean).join('\n\n');
}
export const phraseDetail=(f:I<typeof DraftFeedback>,n:number)=>{const p=f.phrases[n];return p?`${n+1}. ${toneLabels[p.tone]}\n«${p.quote}»\n\nПочему: ${p.why}\n\nВариант мягче: «${p.softer}»`:null;};

export const direct=(d:I<typeof DirectV2>)=>`Варианты прямее:\n\n${d.variants.map((v,n)=>`${n+1}. «${v.text}»\n${v.explanation}`).join('\n\n')}\n\nЧто сохранено: ${d.preservedMeaning}${d.changeNotes.length?`\n\nЧто изменено:\n${list(d.changeNotes)}`:''}\n\nЭто варианты твоей формулировки, а не определение чьих-то намерений.`;
export const exercise=(e:{instruction:string;skill:I<typeof Skill>;exampleHint:string})=>`Упражнение (30–60 секунд) · навык: ${skillLabels[e.skill]}\n\n${e.instruction}\n\nПодсказка: ${e.exampleHint}\n\nНапиши свою попытку одним сообщением.`;
export const feedback=(f:I<typeof Feedback>)=>[f.strengths.length?`Что получилось:\n${list(f.strengths)}`:'',`Что улучшить: ${f.improvement}`,`Как могло бы звучать: «${f.suggestedAttempt}»`].filter(Boolean).join('\n\n');
export const roleplayFeedback=(f:I<typeof RoleFeedback>)=>`Итог тренировки\n\n${f.strengths.length?`Удачные действия:\n${list(f.strengths)}\n\n`:''}${f.improvements.length?`Что можно попробовать:\n${list(f.improvements)}\n\n`:''}Следующий навык: ${f.nextPractice}`;
export const roleplayMessage=(content:string,turnCount:number)=>`Собеседник:\n${content}\n\nТвой ответ ${turnCount+1} из 3. Напиши его сообщением.`;
export const clarifyRun=(c:{questions:string[];explanation:string})=>`Как можно уточнить:\n${list(c.questions)}\n\n${c.explanation}`;

export function progress(p:I<typeof ProgressV2>) {
  const skills=p.skills.length?p.skills.map(s=>`• ${skillLabels[s.skill]}: практик ${s.completedAttempts}${s.latestScore===null?'':`, последняя оценка попытки ${s.latestScore}/2`}`).join('\n'):'пока нет';
  const streak=p.streak.current?`Серия практики дня: ${p.streak.current} (лучшая ${p.streak.best}). Пропуски не штрафуются.`:'Серии пока нет — практика дня необязательна.';
  return `Твоя практика\n\nРазобрано ситуаций: ${p.analyzedSessions}\nЗавершено упражнений: ${p.completedExercises}\nЗавершено диалогов: ${p.completedRoleplays}\nПрактик дня: ${p.completedDailyPractices}\nКарточек: ${p.completedCards}\n${streak}\n\nНавыки (число практик и оценка конкретной попытки по рубрике 0–2, не оценка тебя):\n${skills}${p.latestTip?`\n\nПоследний совет: ${p.latestTip}`:''}${p.followupEligibleAt?`\n\nПовторный тест доступен с ${new Date(p.followupEligibleAt).toLocaleDateString('ru-RU')}.`:''}\n\nПроцента эмпатии нет: это счётчики твоих учебных действий.`;
}
export const attempts=(items:I<typeof SkillAttempt>[])=>items.length?items.map(a=>`• ${skillLabels[a.skill]} — ${a.score}/2: ${a.rationale}`).join('\n'):'Оценённых попыток пока нет.';

export const practice=(p:I<typeof Practice>)=>`Практика дня · ${skillLabels[p.skill]} · около 2 минут\n\n${p.title}\n\n${p.instruction}\n\nМожно пропустить — серия не наказывает за пропуски.`;
export const card=(c:I<typeof Card>)=>`${c.title} · ${skillLabels[c.skill]}${c.completed?' · пройдена':''}\n\n${c.theory}\n\nПример:\n${c.example}\n\nПопробуй:\n${c.practice}\n\nКарточки — учебный материал, а не психологическая помощь.`;

export function reminders(r:I<typeof ReminderSettings>) {
  return `Напоминания о практике дня\n\nСейчас: ${r.enabled?'включены':'выключены'}\nВремя: ${r.localTime}\nЧасовой пояс: ${r.timezone}\nТихие часы: ${r.quietHours.enabled?`${r.quietHours.start}–${r.quietHours.end}`:'нет'}\n\nНапоминания необязательны и приходят только сюда, в Telegram. Выключить можно в любой момент.`;
}

export const assessmentIntro=(f:I<typeof AssessmentForm>)=>`${f.kind==='baseline'?'Входной тест':'Повторный тест'} · ${f.tasks.length} заданий\n\nДобровольно. Результат покажу после всей серии — это учебный результат, не оценка эмпатии и не рейтинг.`;
export const assessmentTask=(f:I<typeof AssessmentForm>,i:number)=>{const t=f.tasks[i]!;return `Задание ${i+1} из ${f.tasks.length}\n\n${t.prompt}\n\n${t.choices.map((c,n)=>`${n+1}. ${c.text}`).join('\n')}`;};
export const assessmentResult=(r:I<typeof AssessmentResult>)=>`Результат ${r.kind==='baseline'?'входного':'повторного'} теста\n\n${r.scores.map((s,n)=>`${n+1}. ${s.score}/2 — ${s.rationale}`).join('\n')}\n\n${r.notice}.${r.followupEligibleAt?`\n\nПовторный тест будет доступен с ${new Date(r.followupEligibleAt).toLocaleDateString('ru-RU')}.`:''}`;

export function support(s:I<typeof Support>) {
  const contacts=s.contacts.map(c=>`• ${c.label}${c.phone?`: ${c.phone}`:''}${c.url?` ${c.url}`:''} (проверено ${new Date(c.verifiedAt).toLocaleDateString('ru-RU')})`).join('\n');
  return `${s.message}${contacts?`\n\n${contacts}`:''}\n\nЯ не могу вызвать помощь или написать кому-то за тебя, и могу не распознать опасность. Можно спокойно подготовить просьбу о поддержке или фразу, обозначающую границу.`;
}

export const runFailure:Record<string,string>={
  RUN_INTERRUPTED:'Обработка прервалась из-за перезапуска сервера.',
  MODEL_TIMEOUT:'Модель не ответила вовремя.',
  MODEL_UNAVAILABLE:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен).',
  MODEL_INVALID_OUTPUT:'Модель вернула ответ в неверном формате — показывать его нельзя.',
  MODEL_REFUSED:'Модель отказалась отвечать на этот запрос.',
  PREVIEW_STALE:'Предпросмотр устарел — нужно подтвердить новый.',
  INPUT_TOO_LARGE:'Текст не поместился в контекст модели. Сократи его.',
  CONFIGURATION_ERROR:'Сервис настроен не полностью.'
};

export const webLink=(url:string)=>`Ссылка для входа на сайт (действует 5 минут, одноразовая):\n${url}\n\n⚠️ Ссылка даёт доступ к твоему аккаунту. Не пересылай её никому. На сайте нужно будет нажать «Подтвердить вход».`;
export const shortTitle=(value:string,max=48)=>{const line=value.replace(/\s+/g,' ').trim();return line.length>max?`${line.slice(0,max-1)}…`:line;};
export const maskEmail=(e:string)=>e.replace(/^(.).*(@.*)$/,'$1***$2');
