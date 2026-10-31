import type {OutputFor,Progress,Goal} from '@between/contracts';
import type {z} from 'zod';
import type {AnalysisOutput,ContextType,Difficulty,DirectOutput,DraftFields,EvidenceLevel,Preview,ReplyFeedbackOutput} from './domain.js';

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

export const limits={message:6000,relationship:200,context:4000,text:3000,emotion:100,emotions:3,quotes:3,email:254,title:200} as const;

export const goalLabels:Record<z.infer<typeof Goal>,string>={support:'Поддержать',clarify:'Уточнить',reconcile:'Помириться',boundary:'Обозначить границу'};

const list=(items:string[],mark='•')=>items.map(item=>`${mark} ${item}`).join('\n');
const quotes=(items:string[])=>items.length?`Опора в тексте: ${items.map(q=>`«${q}»`).join(', ')}`:'Опора в тексте: прямых слов нет — это предположение.';

export const texts={
  greeting:'Привет! Это «Между строк» — тренажёр понимания переписки.\n\nНесколько возможных трактовок. Мысли не читаем.\n\nТы присылаешь сообщение, сначала даёшь свою версию, а я показываю 2–3 возможных прочтения, что в тексте на них указывает и что остаётся неизвестным. Потом можно потренировать ответ.',
  onboarding:'Перед началом:\n• Разбор — это гипотезы, а не правда о чувствах другого человека.\n• Убирай из текста имена, телефоны, адреса и другие личные данные.\n• Тексты проходят через Telegram и хранятся на сервере проекта, пока ты их не удалишь.\n\nНужна почта: на неё придёт одноразовый код. Пароль не нужен.',
  askEmail:'Напиши адрес почты, на который отправить код.',
  menu:'Главное меню. Что делаем?',
  help:'Команды:\n/menu — главное меню\n/cancel — отменить текущий шаг\n/history — сохранённые разборы\n/account — почта и удаление данных\n/help — эта справка\n\n«Понять сообщение» — разбор чужого сообщения с твоей гипотезой.\n«Сказать прямо» — переформулировать свою фразу яснее, не меняя смысла.',
  groupOnly:'Я работаю только в личном чате, чтобы чужие сообщения из группы не попадали в разбор. Открой личный чат со мной.',
  stale:'Этот шаг уже завершён.',
  cancelled:'Текущий шаг отменён, черновик удалён.',
  accepted:'Запрос принят.',
  needVerify:'Сначала подтверди почту — после этого откроются разборы и история.',
  unknownInput:'Сейчас я жду нажатия кнопки. Черновик сохранён. /menu — главное меню, /cancel — отменить.',
  modelDown:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен). Меню, история и аккаунт работают. Попробуй повторить позже.',
  busy:'Предыдущий запрос ещё выполняется. Дождись результата — он придёт сюда.',
  rateLimited:'Очередь сейчас заполнена. Попробуй повторить чуть позже.',
  conflict:'Данные изменились в другом месте. Открой разбор заново из истории.',
  notFound:'Такой записи нет или она удалена.',
  internal:'Что-то пошло не так. Черновик сохранён, попробуй ещё раз.',
  privacyHint:'Подсказка: убери имена, телефоны и адреса, если они есть в тексте.'
};

export const tooLong=(max:number,actual:number)=>`Слишком длинно: ${actual} символов, можно до ${max}. Сократи и пришли ещё раз — предыдущие шаги сохранены.`;

export function queued(position:number|undefined) {
  if(position===undefined||position===0)return texts.accepted+' Ответ придёт отдельным сообщением.';
  return `${texts.accepted} Место в очереди: ${position}. Ответ придёт отдельным сообщением.`;
}

const evidenceLabels:Record<EvidenceLevel,string>={text:'есть текстовые основания',context:'зависит от контекста',insufficient:'данных недостаточно'};

export function analysis(a:AnalysisOutput) {
  const variants=a.interpretations.map((i,n)=>`${n+1}. ${i.emotion} → возможная потребность: ${i.possibleNeed}${i.evidenceLevel?`\nОснования: ${evidenceLabels[i.evidenceLevel]}`:''}\n${i.explanation}\n${quotes(i.evidenceQuotes)}`).join('\n\n');
  const c=a.comparison;
  const comparison=c?`\n\nТвоя версия и другие версии\nГде совпало: ${c.matches.length?c.matches.join('; '):'явных совпадений нет — это нормально'}\nДругие возможные версии: ${c.alternatives.length?c.alternatives.join('; '):'—'}\nЧто уточнить: ${c.toClarify.length?c.toClarify.join('; '):'—'}\nСовпадение с разбором не означает «правильно»: это ещё одна гипотеза.`:'';
  return `Буквально: ${a.literalMeaning}\n\nВозможные трактовки (гипотезы, а не факты; категории оснований — оценка модели, не вероятность чувства):\n\n${variants}\n\nЧто неизвестно: ${a.uncertainty}${comparison}\n\nО твоей версии: ${a.guessFeedback}\n\nСовет: ${a.skillTip}`;
}

export const clarify=(a:AnalysisOutput)=>`Нейтральный уточняющий вопрос:\n«${a.clarifyingQuestion}»`;

export function options(items:OutputFor<'reply_examples'>) {
  return items.map(o=>`${goalLabels[o.goal]}:\n«${o.text}»\n${o.explanation}`).join('\n\n');
}

const toneMark={risky:'🟠 стоит пересмотреть',caution:'🟡 может прозвучать двояко',good:'🟢 удачно'} as const;

export function replyFeedback(f:ReplyFeedbackOutput) {
  const phrases=f.phraseFeedback.map((p,n)=>`${n+1}. ${p.tone?toneMark[p.tone]:'🟡 обрати внимание'}\n«${p.quote}»\nКак может прозвучать: ${p.possibleImpact}\nВозможная замена: ${p.suggestion}`).join('\n\n');
  return [f.strengths.length?`Сильные стороны черновика:\n${list(f.strengths)}`:'',phrases?`Фразы (это возможное восприятие, не оценка тебя):\n\n${phrases}`:'',`Вариант доработки:\n«${f.revisedReply}»`,`Примеры под разные цели:\n\n${options(f.options)}`].filter(Boolean).join('\n\n');
}
export const phraseWhy=(f:ReplyFeedbackOutput,n:number)=>{const p=f.phraseFeedback[n];return p?`«${p.quote}»\n\nПочему: ${p.why??p.possibleImpact}`:null;};
export const phraseSofter=(f:ReplyFeedbackOutput,n:number)=>{const p=f.phraseFeedback[n];return p?`Вариант мягче для «${p.quote}»:\n«${p.softer??p.suggestion}»`:null;};

export const exercise=(e:OutputFor<'exercise'>)=>`Упражнение (30–60 секунд) · навык: ${e.skill}\n\n${e.instruction}\n\nПодсказка: ${e.exampleHint}\n\nНапиши свою попытку одним сообщением.`;

export const exerciseFeedback=(f:OutputFor<'exercise_feedback'>)=>[f.strengths.length?`Что получилось:\n${list(f.strengths)}`:'',`Что улучшить: ${f.improvement}`,`Как могло бы звучать: «${f.suggestedAttempt}»`].filter(Boolean).join('\n\n');

export const roleplayFeedback=(f:OutputFor<'roleplay_feedback'>)=>`Итог тренировки\n\n${f.strengths.length?`Удачные действия:\n${list(f.strengths)}\n\n`:''}${f.improvements.length?`Что можно попробовать:\n${list(f.improvements)}\n\n`:''}Следующий навык: ${f.nextPractice}`;

export const roleplayMessage=(content:string,turnCount:number)=>`Собеседник:\n${content}\n\nТвой ответ ${turnCount+1} из 3. Напиши его сообщением.`;

export function progress(p:z.infer<typeof Progress>) {
  const skills=p.skills.length?p.skills.map(s=>`• ${s.skill}: ${s.count}`).join('\n'):'пока нет';
  return `Твоя практика\n\nРазобрано ситуаций: ${p.analyzedSessions}\nЗавершено упражнений: ${p.completedExercises}\nЗавершено диалогов: ${p.completedRoleplays}\n\nПрактикуемые навыки:\n${skills}${p.latestTip?`\n\nПоследний совет: ${p.latestTip}`:''}`;
}

export function direct(d:DirectOutput) {
  const variants=d.variants.map((v,n)=>`${n+1}. «${v.text}»\n${v.explanation}`).join('\n\n');
  return `${d.attemptFeedback?`О твоей формулировке: ${d.attemptFeedback}\n\n`:''}Варианты прямее:\n\n${variants}\n\nЧто сохранено: ${d.preserved}\n\nЭто варианты формулировки, а не определение чьих-то намерений.`;
}

export const runFailure:Record<string,string>={
  RUN_INTERRUPTED:'Обработка прервалась из-за перезапуска сервера.',
  MODEL_TIMEOUT:'Модель не ответила вовремя.',
  MODEL_UNAVAILABLE:'Модель сейчас недоступна (компьютер с моделью выключен или перегружен).',
  MODEL_INVALID_OUTPUT:'Модель вернула ответ в неверном формате — показывать его нельзя.',
  MODEL_REFUSED:'Модель отказалась отвечать на этот запрос.',
  CONFIGURATION_ERROR:'Сервис настроен не полностью.'
};

export const contextLabels:Record<ContextType,string>={close:'Близкие',colleague:'Коллеги',teacher:'Преподаватель',client:'Клиент'};
export const difficultyLabels:Record<Difficulty,string>={calm:'Спокойный',hurt:'Обиженный',irritated:'Раздражённый'};

const field=(label:string,value:string|undefined|null)=>value?`${label}:\n${value}`:'';
export function preview(p:Preview) {
  const f:DraftFields=p.fields;
  const guess=f.guess?(f.guess.unsure?'Моя версия: не понимаю':`Моя версия: ${f.guess.emotions.join(', ')||'—'}${f.guess.evidenceQuotes.length?`\nСигналы: ${f.guess.evidenceQuotes.map(q=>`«${q}»`).join(', ')}`:''}`):'';
  const body=[field('Сообщение',f.message),field('Собеседник',f.relationship),f.contextType?`Сфера: ${contextLabels[f.contextType]}`:'',field('Контекст',f.context),f.goal?`Цель: ${goalLabels[f.goal]}`:'',field('Что хочется выразить',f.intent),field('Моя формулировка',f.attempt),field('Текст',f.text),guess].filter(Boolean).join('\n\n');
  const masked=p.maskedCount?`Автоматически скрыто телефонов/почт: ${p.maskedCount}.`:'Телефонов и почт не найдено.';
  return `Так текст уйдёт в модель (проверь все поля):\n\n${body}\n\n${masked} Имена и адреса проверь сам и при необходимости нажми «Редактировать». Это помощь, а не гарантия анонимности.`;
}

export const danger='Похоже, в ситуации может быть угроза или опасность. Обычный разбор и тренировку здесь лучше отложить.\n\nЕсли опасность непосредственная — обратись к человеку рядом или в местную экстренную службу. Я не могу вызвать помощь или написать кому-то за тебя.\n\nЕсли хочешь, можно спокойно подготовить просьбу о поддержке или фразу, обозначающую границу.';

export const shortTitle=(value:string,max=48)=>{const line=value.replace(/\s+/g,' ').trim();return line.length>max?`${line.slice(0,max-1)}…`:line;};
