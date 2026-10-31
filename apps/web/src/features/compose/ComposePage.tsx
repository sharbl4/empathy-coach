import {useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import {SessionInputV2,type ContextType,type Goal,type LearningMode} from '@between/contracts/product';
import {navigate,useLocation} from '../../app/router';
import {Button,Loading,Notice,TextArea,TextField} from '../../components/ui';
import {api,errorText,newKey} from '../../lib/api';
import {contextLabels,goalLabels,modeLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';
import {sourceKind} from '../preview/source';
import {recordStage} from '../../lib/stage';
import {cleanDraft,saveDialogue,type Dialogue,type Draft} from '../../lib/dialogue';
import {isApiError} from '../../lib/api';

type Mode=z.infer<typeof LearningMode>;type Ctx=z.infer<typeof ContextType>;type GoalValue=z.infer<typeof Goal>;
interface Turn {id:string;speaker:'self'|'other';text:string}

/** One composer for the four modes. Nothing goes to the model here: next step is the server preview. Input stays in memory only. */
export function ComposePage() {
  const {search}=useLocation();
  const exampleId=new URLSearchParams(search).get('example');
  const [mode,setMode]=useState<Mode>('understand');
  const [message,setMessage]=useState('');const [draft,setDraft]=useState('');const [intent,setIntent]=useState('');
  const [relationship,setRelationship]=useState('');const [context,setContext]=useState('');
  const [contextType,setContextType]=useState<Ctx>('close');const [goal,setGoal]=useState<GoalValue>('clarify');
  const [turns,setTurns]=useState<Turn[]>([]);const [turnText,setTurnText]=useState('');const [speaker,setSpeaker]=useState<'self'|'other'>('other');
  const [emotions,setEmotions]=useState('');const [quotes,setQuotes]=useState<string[]>([]);const [quote,setQuote]=useState('');const [unsure,setUnsure]=useState(false);
  const [title,setTitle]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const key=useRef(newKey());
  const dialogue=useRef<Dialogue|null>(null);
  const [restored,setRestored]=useState(false);
  const [conflict,setConflict]=useState<Dialogue|null>(null);
  const [saveError,setSaveError]=useState<string|null>(null);
  const fill=(d:Draft)=>{
    if(d.mode)setMode(d.mode);if(d.message)setMessage(d.message);if(d.draft)setDraft(d.draft);if(d.intent!==undefined)setIntent(d.intent);
    if(d.relationship)setRelationship(d.relationship);if(d.context!==undefined)setContext(d.context);if(d.contextType)setContextType(d.contextType);if(d.goal)setGoal(d.goal);
    if(d.turns)setTurns(d.turns);if(d.title)setTitle(d.title);
    if(d.guess){setUnsure(d.guess.unsure);setEmotions(d.guess.emotions.join(', '));setQuotes(d.guess.quotes);}
  };
  // Continue an unfinished draft started in the bot or another window (shared dialogue in the DB).
  const loaded=useAsync(async signal=>exampleId?null:api('dialogue',{},{signal}),[exampleId]);
  useEffect(()=>{
    const d=loaded.data;if(!d)return;dialogue.current=d;
    if((d.step==='compose'||d.step==='guess')&&d.draft.mode&&!d.sessionId){fill(d.draft);setRestored(true);}
  },[loaded.data]);
  // Any change is a new intent: a new Idempotency-Key, so an edited form never reuses an old result.
  useEffect(()=>{key.current=newKey();},[mode,message,draft,intent,relationship,context,contextType,goal,turns,emotions,quotes,unsure,title]);
  const example=useAsync(async signal=>exampleId?api('example',{id:exampleId},{signal}):null,[exampleId]);
  useEffect(()=>{
    const e=example.data;if(!e)return;const i=e.input;
    setMode(i.mode);setRelationship(i.relationship);setContext(i.context);setContextType(i.contextType);setGoal(i.goal);setTitle(i.title);
    if(i.mode==='understand')setMessage(i.message);
    if(i.mode==='thread')setTurns(i.turns);
    if(i.mode==='say_direct'){setDraft(i.draft);setIntent(i.intent);}
    if(i.mode==='before_send')setDraft(i.draft);
  },[example.data]);
  const currentDraft=():Draft|null=>cleanDraft({mode,title,message:mode==='understand'?message:undefined,draft:mode==='say_direct'||mode==='before_send'?draft:undefined,intent:mode==='say_direct'?intent:undefined,
    relationship,context,contextType,goal,turns:mode==='thread'?turns:undefined,guess:mode==='understand'||mode==='thread'?{emotions:unsure?[]:emotions.split(',').map(x=>x.trim()).filter(Boolean).slice(0,3),quotes:unsure?[]:quotes,unsure}:undefined});
  // Debounced save of the draft into the shared dialogue; a concurrent change from the bot is shown, not overwritten.
  useEffect(()=>{
    if(!dialogue.current||conflict||busy)return;
    const timer=window.setTimeout(()=>{
      const d=currentDraft(),current=dialogue.current;if(!d||!current)return;
      saveDialogue(current,{step:'compose',draft:d}).then(next=>{dialogue.current=next;setSaveError(null);},error=>{
        if(isApiError(error,'REVISION_CONFLICT'))void api('dialogue',{}).then(setConflict,()=>setSaveError(errorText(error)));
        else setSaveError(errorText(error));
      });
    },800);
    return ()=>window.clearTimeout(timer);
  },[mode,message,draft,intent,relationship,context,contextType,goal,turns,emotions,quotes,unsure,title,conflict,busy,loaded.data]);
  const sources=mode==='thread'?turns.map(t=>t.text):[message];
  const guessable=mode==='understand'||mode==='thread';
  const addQuote=()=>{const v=quote.trim();if(!v)return;if(!sources.some(s=>s.includes(v))){setError('Такой цитаты нет в тексте — скопируйте слова точно.');return;}setError(null);if(!quotes.includes(v)&&quotes.length<3)setQuotes([...quotes,v]);setQuote('');};
  const submit=async()=>{
    setError(null);
    const base={relationship:relationship.trim(),context:context.trim(),contextType,goal};
    const guess={emotions:unsure?[]:emotions.split(',').map(x=>x.trim()).filter(Boolean),quotes:unsure?[]:quotes,unsure};
    const auto=(mode==='understand'?message:mode==='thread'?turns[0]?.text??'':draft).replace(/\s+/g,' ').trim().slice(0,60)||modeLabels[mode];
    const raw=mode==='understand'?{...base,title:title||auto,mode,message,guess}:mode==='thread'?{...base,title:title||auto,mode,turns,guess}:mode==='say_direct'?{...base,title:title||auto,mode,draft,intent}:{...base,title:title||auto,mode,draft};
    const parsed=SessionInputV2.safeParse(raw);
    if(!parsed.success){setError('Проверьте поля: обязательные заполнены, длина в пределах, цитаты точно из текста, не больше 3 эмоций.');return;}
    setBusy(true);
    try{
      const session=await api('createSession',parsed.data,{key:key.current});
      // The draft became a saved situation: clear it from the shared dialogue so the bot does not resume it.
      if(dialogue.current)await saveDialogue(dialogue.current,{step:'menu'}).catch(()=>{});
      const preview=await api('createPreview',{kind:sourceKind(mode),sessionId:session.id,expectedRevision:session.revision},{key:newKey()});
      recordStage('preview_created',{contextType,resourceId:preview.id});
      navigate(`/previews/${preview.id}`);
    }catch(e){setError(errorText(e));setBusy(false);}
  };
  if(exampleId&&example.loading)return <Loading label="Загружаем пример"/>;
  return (
    <>
      <h1>Новый разбор</h1>
      {restored&&<Notice title="Продолжаем черновик">Черновик сохранён на сервере (например, начат в боте). Изменения сохраняются автоматически.</Notice>}
      {conflict&&<Notice tone="error" title="Черновик изменили в боте или другом окне" action={<>
        <Button variant="secondary" onClick={()=>{dialogue.current=conflict;fill(conflict.draft);setConflict(null);}}>Загрузить их версию</Button>
        <Button variant="secondary" onClick={()=>{dialogue.current=conflict;setConflict(null);}}>Оставить мою</Button></>}>Ничего не перезаписано. Выберите, какую версию продолжить.</Notice>}
      {saveError&&<Notice tone="error">Черновик не сохранился на сервере: {saveError} Введённое остаётся на странице.</Notice>}
      {example.data&&<Notice title="Вымышленный пример">Разбор сгенерирует настоящая локальная модель — заготовленных ответов нет. Сначала попробуйте свою версию.</Notice>}
      <form className="grid-form" onSubmit={e=>{e.preventDefault();void submit();}}>
        <fieldset><legend>Режим</legend><div className="chips">{(Object.keys(modeLabels) as Mode[]).map(m=><button key={m} type="button" className="chip" aria-pressed={mode===m} onClick={()=>setMode(m)}>{modeLabels[m]}</button>)}</div></fieldset>
        <Notice>Перед отправкой в модель вы увидите точную копию: телефоны и почты скрываются автоматически, имена и адреса проверьте сами. Это помощь, а не гарантия анонимности.</Notice>
        {mode==='understand'&&<TextArea label="Сообщение, которое хотите понять" value={message} maxLength={6000} counter={{value:message.length,max:6000}} onChange={e=>setMessage(e.target.value)} required/>}
        {(mode==='say_direct'||mode==='before_send')&&<TextArea label={mode==='say_direct'?'Ваша фраза, которую хотите сказать прямее':'Ваш черновик (сообщение собеседника не нужно)'} hint={mode==='say_direct'?'Смысл, эмоция, отказ и границы сохранятся.':undefined} value={draft} maxLength={6000} counter={{value:draft.length,max:6000}} onChange={e=>setDraft(e.target.value)} required/>}
        {mode==='say_direct'&&<TextField label="Что хотите выразить (необязательно)" value={intent} maxLength={1000} onChange={e=>setIntent(e.target.value)}/>}
        {mode==='thread'&&<section aria-label="Ветка переписки" className="card">
          <p className="small muted">До 20 реплик по порядку. Явно укажите, кто говорит. Чужие чаты автоматически не читаются.</p>
          <ol className="turns">{turns.map((t,i)=><li key={t.id} className={`turn turn-${t.speaker}`}>
            <strong>{t.speaker==='self'?'Я':'Собеседник'}</strong>
            <textarea aria-label={`Реплика ${i+1}`} value={t.text} maxLength={3000} onChange={e=>setTurns(turns.map(x=>x.id===t.id?{...x,text:e.target.value}:x))}/>
            <span className="actions">
              <Button variant="ghost" aria-label={`Поднять реплику ${i+1}`} disabled={i===0} onClick={()=>{const n=[...turns];[n[i-1],n[i]]=[n[i]!,n[i-1]!];setTurns(n);}}>↑</Button>
              <Button variant="ghost" aria-label={`Сменить говорящего в реплике ${i+1}`} onClick={()=>setTurns(turns.map(x=>x.id===t.id?{...x,speaker:x.speaker==='self'?'other':'self'}:x))}>⇄</Button>
              <Button variant="ghost" aria-label={`Удалить реплику ${i+1}`} onClick={()=>setTurns(turns.filter(x=>x.id!==t.id))}>✕</Button>
            </span>
          </li>)}</ol>
          <div className="row">
            <div className="field"><label htmlFor="turn-speaker">Кто говорит</label><select id="turn-speaker" value={speaker} onChange={e=>setSpeaker(e.target.value as 'self'|'other')}><option value="other">Собеседник</option><option value="self">Я</option></select></div>
            <TextArea label="Текст реплики" value={turnText} maxLength={3000} onChange={e=>setTurnText(e.target.value)}/>
            <Button variant="secondary" disabled={!turnText.trim()||turns.length>=20} onClick={()=>{setTurns([...turns,{id:newKey(),speaker,text:turnText.trim()}]);setTurnText('');}}>Добавить реплику</Button>
          </div>
        </section>}
        <TextField label="Кто этот человек" hint="Например: друг, мама, коллега" value={relationship} maxLength={200} onChange={e=>setRelationship(e.target.value)} required/>
        <fieldset><legend>Сфера</legend><div className="chips">{(Object.keys(contextLabels) as Ctx[]).map(c=><button key={c} type="button" className="chip" aria-pressed={contextType===c} onClick={()=>setContextType(c)}>{contextLabels[c]}</button>)}</div></fieldset>
        <TextArea label="Что было до этого (необязательно)" value={context} maxLength={4000} counter={{value:context.length,max:4000}} onChange={e=>setContext(e.target.value)}/>
        <fieldset><legend>Цель</legend><div className="chips">{(Object.keys(goalLabels) as GoalValue[]).map(g=><button key={g} type="button" className="chip" aria-pressed={goal===g} onClick={()=>setGoal(g)}>{goalLabels[g]}</button>)}</div></fieldset>
        {guessable&&<section className="card" aria-label="Сначала ваша версия">
          <h2>Сначала ваша версия</h2>
          <label className="checkbox"><input type="checkbox" checked={unsure} onChange={e=>setUnsure(e.target.checked)}/>Не понимаю — это нормально</label>
          {!unsure&&<>
            <TextField label="Что, по-вашему, чувствует собеседник (до 3, через запятую)" value={emotions} maxLength={320} onChange={e=>setEmotions(e.target.value)}/>
            <div className="inline-add"><TextField label="Точная цитата-сигнал из текста" value={quote} onChange={e=>setQuote(e.target.value)}/><Button variant="secondary" disabled={quotes.length>=3} onClick={addQuote}>Добавить</Button></div>
            {quotes.length>0&&<ul className="quote-list">{quotes.map(x=><li key={x}>«{x}»<button type="button" className="link-button" onClick={()=>setQuotes(quotes.filter(y=>y!==x))}>убрать</button></li>)}</ul>}
          </>}
        </section>}
        <TextField label="Название в истории (необязательно)" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/>
        {error&&<Notice tone="error">{error}</Notice>}
        <div className="actions"><Button type="submit" busy={busy}>Показать, что уйдёт в модель</Button></div>
      </form>
    </>
  );
}

export function ExamplesPage() {
  const [contextType,setContextType]=useState<Ctx|''>('');
  const list=useAsync(signal=>api('examples',{limit:20,...(contextType?{contextType}:{})},{signal}),[contextType]);
  return (
    <>
      <h1>Попробовать на примере</h1>
      <p>Вымышленные ситуации. Ответы генерирует настоящая модель. Одна и та же фраза может встречаться в разных сферах — сравните разборы.</p>
      <div className="field"><label htmlFor="examples-context">Сфера</label><select id="examples-context" value={contextType} onChange={e=>setContextType(e.target.value as Ctx|'')}><option value="">Все</option>{Object.entries(contextLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
      {list.loading&&<Loading label="Загружаем примеры"/>}
      {list.error!==undefined&&<Notice tone="error">{errorText(list.error)}</Notice>}
      {list.data&&!list.data.items.length&&<p className="muted">Примеров в этой сфере нет.</p>}
      <ul className="history-list">{list.data?.items.map(e=><li key={e.id} className="history-item"><div><a className="history-title" href={`/new?example=${encodeURIComponent(e.id)}`} onClick={ev=>{ev.preventDefault();navigate(`/new?example=${encodeURIComponent(e.id)}`);}}>{e.input.title}</a><p className="small muted">{modeLabels[e.input.mode]} · {contextLabels[e.input.contextType]}</p></div></li>)}</ul>
    </>
  );
}
