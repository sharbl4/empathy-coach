import type {z} from 'zod';
import type {OutputFor} from '@between/contracts';
import type {DialogueDraft,Goal,Progress,SayDirectOutput} from '@between/contracts/domain';

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

// Mirrors the Zod limits of @between/contracts/domain DialogueDraft/SayDirectRequest for user-facing hints.
export const limits={message:6000,relationship:200,context:4000,text:3000,emotion:100,emotions:3,quotes:3,feeling:300,need:500,request:1000,title:200} as const;

type GoalValue=z.infer<typeof Goal>;
export const goalLabels:Record<GoalValue,string>={support:'Поддержать',clarify:'Уточнить',reconcile:'Помириться',boundary:'Обозначить границу'};

const list=(items:string[])=>items.map(item=>`• ${item}`).join('\n');
const quotes=(items:string[])=>items.length?`Опора в тексте: ${items.map(q=>`«${q}»`).join(', ')}`:'Опора в тексте: прямых слов нет — это предположение.';

export const texts={
  greeting:'Привет! Это «Между строк» — тренажёр понимания переписки.\n\nНесколько возможных трактовок. Мысли не читаем.\n\nТы присылаешь сообщение, сначала даёшь свою версию, а я показываю 2–3 возможных прочтения, что в тексте на них указывает и что остаётся неизвестным. Потом можно потренировать ответ.',
  onboarding:'Перед началом:\n• Разбор — это гипотезы, а не правда о чувствах другого человека.\n• Убирай из текста имена, телефоны, адреса и другие личные данные.\n• Тексты проходят через Telegram, хранятся на сервере проекта и обрабатываются моделью на компьютере команды, пока ты их не удалишь.\n\nНажимая «Принимаю», ты соглашаешься на обработку по политике проекта (редакция telegram-1). Затем подтвердим почту одноразовым кодом — пароль не нужен.',
  askEmail:'Напиши адрес почты, на который отправить код.',
  menu:'Главное меню. Что делаем?',
  help:'Команды:\n/menu — главное меню\n/cancel — отменить текущий шаг\n/history — сохранённые разборы\n/account — почта, согласие и удаление данных\n/help — эта справка\n\n«Понять сообщение» — разбор чужого сообщения с твоей версией.\n«Сказать прямо» — выразить свои чувства, потребность и просьбу.',
  groupOnly:'Я работаю только в личном чате, чтобы сообщения из группы не попадали в разбор. Открой личный чат со мной.',
  stale:'Этот шаг уже завершён.',
  cancelled:'Текущий шаг отменён, черновик удалён.',
  needVerify:'Сначала подтверди почту — после этого откроются разборы и история.',
  needConsent:'Нужно согласие на обработку данных. Без него новые разборы недоступны; удалить данные можно в /account.',
  unknownInput:'Сейчас я жду нажатия кнопки. Черновик сохранён. /menu — главное меню, /cancel — отменить.',
  modelDown:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен). Меню, история и аккаунт работают. Попробуй повторить позже.',
  busy:'Предыдущий запрос ещё выполняется. Результат придёт сюда.',
  rateLimited:'Слишком много запросов. Попробуй повторить чуть позже.',
  conflict:'Данные изменились (например, в другом окне). Открой актуальную версию из истории.',
  notFound:'Такой записи нет или она удалена.',
  internal:'Что-то пошло не так. Черновик сохранён, попробуй ещё раз.',
  textOnly:'Я понимаю только текст. Скопируй текст сообщения и пришли его. Черновик сохранён.',
  privacyHint:'Подсказка: убери имена, телефоны и адреса, если они есть в тексте.',
  accepted:'Запрос принят. Ответ придёт отдельным сообщением.'
};

export const tooLong=(max:number,actual:number)=>`Слишком длинно: ${actual} символов, можно до ${max}. Сократи и пришли ещё раз — предыдущие шаги сохранены.`;

const field=(label:string,value:string|undefined|null)=>value?`${label}:\n${value}`:'';
/** Exact copy that goes to the model after confirmation. Masking is not implemented by the domain yet: say so. */
export function confirmation(d:z.infer<typeof DialogueDraft>,direct:boolean) {
  const guess=direct?'':d.unsure?'Моя версия: не понимаю':`Моя версия: ${d.emotions?.join(', ')||'—'}${d.evidenceQuotes?.length?`\nСигналы: ${d.evidenceQuotes.map(q=>`«${q}»`).join(', ')}`:''}`;
  const body=[field(direct?'Ситуация':'Сообщение',d.message),field('Собеседник',d.relationship),field('Контекст',d.context),d.goal?`Цель: ${goalLabels[d.goal]}`:'',
    field('Что я чувствую',d.feeling),field('Что мне нужно',d.need),field('О чём прошу',d.request),field('Моя формулировка',direct?d.draft:undefined),guess].filter(Boolean).join('\n\n');
  return `Так текст уйдёт в модель (проверь все поля):\n\n${body}\n\nАвтоматическое скрытие телефонов и почт пока не подключено — проверь сам имена, телефоны и адреса. Исправить можно кнопкой «Изменить» или /cancel.`;
}

export function analysis(a:OutputFor<'analysis'>) {
  const variants=a.interpretations.map((i,n)=>`${n+1}. ${i.emotion} → возможная потребность: ${i.possibleNeed}\n${i.explanation}\n${quotes(i.evidenceQuotes)}`).join('\n\n');
  return `Буквально: ${a.literalMeaning}\n\nВозможные трактовки (это гипотезы, не факты):\n\n${variants}\n\nЧто неизвестно: ${a.uncertainty}\n\nО твоей версии: ${a.guessFeedback}\nСовпадение с разбором не означает «правильно» — это ещё одна гипотеза.\n\nСовет: ${a.skillTip}`;
}
export const clarify=(a:OutputFor<'analysis'>)=>`Нейтральный уточняющий вопрос:\n«${a.clarifyingQuestion}»`;

export const options=(items:OutputFor<'reply_examples'>)=>items.map(o=>`${goalLabels[o.goal]}:\n«${o.text}»\n${o.explanation}`).join('\n\n');

export function replyFeedback(f:OutputFor<'reply_feedback'>) {
  const phrases=f.phraseFeedback.map((p,n)=>`${n+1}. 🟡 обрати внимание\n«${p.quote}»\nКак может прозвучать: ${p.possibleImpact}\nВозможная замена: ${p.suggestion}`).join('\n\n');
  return [f.strengths.length?`Сильные стороны черновика:\n${list(f.strengths)}`:'',phrases?`Фразы (это возможное восприятие, не оценка тебя):\n\n${phrases}`:'',`Вариант доработки:\n«${f.revisedReply}»`,`Примеры под разные цели:\n\n${options(f.options)}`].filter(Boolean).join('\n\n');
}

export const exercise=(e:OutputFor<'exercise'>)=>`Упражнение (30–60 секунд) · навык: ${e.skill}\n\n${e.instruction}\n\nПодсказка: ${e.exampleHint}\n\nНапиши свою попытку одним сообщением.`;
export const exerciseFeedback=(f:OutputFor<'exercise_feedback'>)=>[f.strengths.length?`Что получилось:\n${list(f.strengths)}`:'',`Что улучшить: ${f.improvement}`,`Как могло бы звучать: «${f.suggestedAttempt}»`].filter(Boolean).join('\n\n');
export const roleplayFeedback=(f:OutputFor<'roleplay_feedback'>)=>`Итог тренировки\n\n${f.strengths.length?`Удачные действия:\n${list(f.strengths)}\n\n`:''}${f.improvements.length?`Что можно попробовать:\n${list(f.improvements)}\n\n`:''}Следующий навык: ${f.nextPractice}`;
export const roleplayMessage=(content:string,turnCount:number)=>`Собеседник:\n${content}\n\nТвой ответ ${turnCount+1} из 3. Напиши его сообщением.`;

export function progress(p:z.infer<typeof Progress>) {
  const skills=p.skills.length?p.skills.map(s=>`• ${s.skill}: ${s.count}`).join('\n'):'пока нет';
  return `Твоя практика\n\nРазобрано ситуаций: ${p.analyzedSessions}\nЗавершено упражнений: ${p.completedExercises}\nЗавершено диалогов: ${p.completedRoleplays}\n\nПрактикуемые навыки:\n${skills}${p.latestTip?`\n\nПоследний совет: ${p.latestTip}`:''}`;
}

export const sayDirect=(d:z.infer<typeof SayDirectOutput>)=>`Как сказать о себе прямо\n\nНаблюдение: ${d.observation}\nЧувство: ${d.feeling}\nПотребность: ${d.need}\nПросьба: ${d.request}\n\nСообщение:\n«${d.message}»\n\n${d.explanation}\n\nЭто вариант твоей формулировки, а не определение чьих-то намерений.`;

export const runFailure:Record<string,string>={
  RUN_INTERRUPTED:'Обработка прервалась из-за перезапуска сервера.',
  MODEL_TIMEOUT:'Модель не ответила вовремя.',
  MODEL_UNAVAILABLE:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен).',
  MODEL_INVALID_OUTPUT:'Модель вернула ответ в неверном формате — показывать его нельзя.',
  MODEL_REFUSED:'Модель отказалась отвечать на этот запрос.',
  CONFIGURATION_ERROR:'Сервис настроен не полностью.'
};

export const shortTitle=(value:string,max=48)=>{const line=value.replace(/\s+/g,' ').trim();return line.length>max?`${line.slice(0,max-1)}…`:line;};
export const maskEmail=(e:string)=>e.replace(/^(.).*(@.*)$/,'$1***$2');
