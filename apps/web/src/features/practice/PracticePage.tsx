import {useState} from 'react';
import type {z} from 'zod';
import type {AssessmentForm,AssessmentResult} from '@between/contracts/product';
import {Link,navigate} from '../../app/router';
import {Button,Loading,Notice,TextArea} from '../../components/ui';
import {api,errorText,isApiError,newKey} from '../../lib/api';
import {skillLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';
import {recordStage} from '../../lib/stage';
import {saveDialogue,type Dialogue} from '../../lib/dialogue';

type Form=z.infer<typeof AssessmentForm>;type Result=z.infer<typeof AssessmentResult>;

function Daily() {
  const p=useAsync(signal=>api('dailyPractice',{},{signal}),[]);
  const [done,setDone]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  if(!p.data)return p.loading?<Loading label="Загружаем практику дня"/>:<Notice tone="error">{errorText(p.error)}</Notice>;
  const complete=async()=>{setBusy(true);setError(null);try{const c=await api('completeDailyPractice',{id:p.data!.id,contentVersion:p.data!.contentVersion},{key:newKey()});setDone(c.localDate);recordStage('practice_completed');}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return (
    <section className="card" aria-label="Практика дня">
      <h2>Практика дня <span className="badge">{skillLabels[p.data.skill]}</span></h2>
      <p className="small muted">Около 2 минут. Необязательно: пропуски не штрафуются.</p>
      <h3>{p.data.title}</h3><p>{p.data.instruction}</p>
      {done?<Notice tone="success">Отмечено за {done}. Повторное нажатие не засчитывается дважды.</Notice>:<Button busy={busy} onClick={()=>void complete()}>Выполнено</Button>}
      {error&&<Notice tone="error">{error}</Notice>}
    </section>
  );
}

function Cards() {
  const list=useAsync(signal=>api('cards',{limit:50},{signal}),[]);
  const [openId,setOpen]=useState<string|null>(null);
  return (
    <section className="card" aria-label="Карточки">
      <h2>Карточки</h2>
      <p className="small muted">Короткая теория, пример и практика. Учебный материал, а не психологическая помощь.</p>
      {list.loading&&<Loading label="Загружаем карточки"/>}
      {list.error!==undefined&&<Notice tone="error">{errorText(list.error)}</Notice>}
      <ul className="history-list">{list.data?.items.map(c=><li key={c.id}><div className="history-item"><div><button type="button" className="link-button history-title" aria-expanded={openId===c.id} onClick={()=>setOpen(openId===c.id?null:c.id)}>{c.title}</button><p className="small muted">{skillLabels[c.skill]}{c.completed?' · пройдена':''}</p></div></div>{openId===c.id&&<CardDetail id={c.id} onDone={list.reload}/>}</li>)}</ul>
    </section>
  );
}
function CardDetail({id,onDone}:{id:string;onDone():void}) {
  const c=useAsync(signal=>api('card',{id},{signal}),[id]);
  const [answer,setAnswer]=useState('');const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
  const [started,setStarted]=useState(false);
  // The started task (card id + content version, no text) is saved in the shared dialogue, so the bot can continue it.
  const markStarted=async()=>{
    if(started||!c.data)return;setStarted(true);
    try{const d=await api('dialogue',{});await saveDialogue(d,{step:'card',navigation:{kind:'card',cardId:c.data.id,contentVersion:c.data.contentVersion}});}catch{/* best effort: the attempt itself is still sent through preview */}
  };
  if(!c.data)return c.loading?<Loading label="Открываем"/>:<Notice tone="error">{errorText(c.error)}</Notice>;
  const card=c.data;
  const complete=async()=>{setBusy('done');setError(null);try{await api('completeCard',{id:card.id,contentVersion:card.contentVersion},{key:newKey()});recordStage('card_completed');c.reload();onDone();}catch(e){setError(errorText(e));}finally{setBusy(null);}};
  const tryIt=async()=>{setBusy('try');setError(null);try{const p=await api('createPreview',{kind:'card_feedback',cardId:card.id,contentVersion:card.contentVersion,answer:answer.trim()},{key:newKey()});navigate(`/previews/${p.id}`);}catch(e){setError(errorText(e));setBusy(null);}};
  return (
    <div className="mark-detail">
      <p>{card.theory}</p><p><strong>Пример:</strong></p><p className="message">{card.example}</p><p><strong>Попробуйте:</strong> {card.practice}</p>
      <TextArea label="Ваша попытка" value={answer} maxLength={3000} onFocus={()=>void markStarted()} onChange={e=>setAnswer(e.target.value)}/>
      <div className="actions"><Button busy={busy==='try'} disabled={!answer.trim()} onClick={()=>void tryIt()}>Получить отзыв</Button>{!card.completed&&<Button variant="secondary" busy={busy==='done'} onClick={()=>void complete()}>Отметить пройденной</Button>}</div>
      {error&&<Notice tone="error">{error}</Notice>}
    </div>
  );
}

function Assessment() {
  const [kind,setKind]=useState<'baseline'|'followup'|null>(null);
  const [form,setForm]=useState<Form|null>(null);const [answers,setAnswers]=useState<Record<string,string>>({});
  const [dialogue,setDialogue]=useState<Dialogue|null>(null);
  const [result,setResult]=useState<Result|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const key=useState(newKey)[0];
  const results=useAsync(signal=>api('assessmentResults',{limit:10},{signal}),[result]);
  const ordered=(f:Form,a:Record<string,string>)=>f.tasks.filter(t=>a[t.id]).map(t=>({questionId:t.id,choiceId:a[t.id]!}));
  const open=async(k:'baseline'|'followup')=>{setKind(k);setError(null);setResult(null);setBusy(true);
    try{
      const [f,d]=await Promise.all([api('assessment',{kind:k}),api('dialogue',{})]);
      const nav=d.navigation;
      // Continue answers saved earlier (in the bot or another window) for the same form version.
      const saved=nav.kind==='assessment'&&nav.assessmentId===f.id&&nav.contentVersion===f.contentVersion?Object.fromEntries(nav.answers.map(x=>[x.questionId,x.choiceId])):{};
      setForm(f);setAnswers(saved);setDialogue(d);
    }catch(e){setForm(null);setError(isApiError(e,'ASSESSMENT_NOT_DUE')?'Повторный тест откроется через 7 дней после входного.':errorText(e));}finally{setBusy(false);}};
  const choose=async(taskId:string,choiceId:string)=>{
    if(!form||!dialogue)return;const next={...answers,[taskId]:choiceId};setAnswers(next);setError(null);
    try{setDialogue(await saveDialogue(dialogue,{step:'assessment',navigation:{kind:'assessment',assessmentId:form.id,contentVersion:form.contentVersion,assessmentKind:form.kind,answers:ordered(form,next)}}));}
    catch(e){setError(isApiError(e,'REVISION_CONFLICT')?'Ответы изменились в боте или другом окне. Откройте тест заново, чтобы увидеть сохранённые.':`Ответ не сохранился: ${errorText(e)}`);}
  };
  const submit=async()=>{if(!form||!dialogue)return;setBusy(true);setError(null);
    try{setResult(await api('submitAssessment',{id:form.id,contentVersion:form.contentVersion,expectedDialogueRevision:dialogue.revision,answers:ordered(form,answers)},{key}));recordStage('assessment_completed');setForm(null);}
    catch(e){setError(isApiError(e,'REVISION_CONFLICT')?'Ответы изменились в боте или другом окне. Откройте тест заново.':errorText(e));}finally{setBusy(false);}};
  return (
    <section className="card" aria-label="Тест до и после">
      <h2>Тест до/после</h2>
      <p className="small muted">Добровольно, 3–5 заданий, без рейтинга. Каждый ответ сохраняется сразу (можно продолжить в боте). Результат по рубрике 0–2 — после всей серии. Повторный тест — через 7 дней.</p>
      <div className="actions"><Button variant="secondary" busy={busy&&kind==='baseline'} onClick={()=>void open('baseline')}>Входной тест</Button><Button variant="secondary" busy={busy&&kind==='followup'} onClick={()=>void open('followup')}>Повторный тест</Button></div>
      {error&&<Notice tone="error">{error}</Notice>}
      {form&&form.submittedAt&&<Notice>Этот тест уже пройден.</Notice>}
      {form&&!form.submittedAt&&<form className="grid-form" onSubmit={e=>{e.preventDefault();void submit();}}>
        {form.tasks.map((t,n)=><fieldset key={t.id}><legend>{n+1}. {t.prompt}</legend><div className="choice-grid">{t.choices.map(c=><label key={c.id} className={`choice${answers[t.id]===c.id?' choice-on':''}`}><input type="radio" name={t.id} checked={answers[t.id]===c.id} onChange={()=>void choose(t.id,c.id)}/><span>{c.text}</span></label>)}</div></fieldset>)}
        <Button type="submit" busy={busy} disabled={form.tasks.some(t=>!answers[t.id])}>Отправить ответы</Button>
      </form>}
      {result&&<Notice tone="success" title="Результат"><ol>{result.scores.map(s=><li key={s.questionId}>{s.score}/2 — {s.rationale}</li>)}</ol><p>{result.notice}.</p>{result.followupEligibleAt&&<p>Повторный тест будет доступен с {new Date(result.followupEligibleAt).toLocaleDateString('ru-RU')}. Напоминание — только если включите его в настройках.</p>}</Notice>}
      {results.data&&results.data.items.length>0&&<><h3>Прошлые результаты</h3><ul>{results.data.items.map(r=><li key={r.id}>{r.kind==='baseline'?'Входной':'Повторный'} · {new Date(r.completedAt).toLocaleDateString('ru-RU')}: {r.scores.map(s=>s.score).join(' · ')}</li>)}</ul></>}
    </section>
  );
}

export function PracticePage() {
  return <><h1>Практика</h1><p><Link to="/examples">Попробовать на вымышленном примере →</Link></p><Daily/><Cards/><Assessment/></>;
}
