import {useState} from 'react';
import type {z} from 'zod';
import type {Difficulty,PreviewSource} from '@between/contracts/product';
import {Link,navigate} from '../../app/router';
import {Modal} from '../../components/Modal';
import {Button,Loading,Notice,TextArea} from '../../components/ui';
import {api,errorText,newKey} from '../../lib/api';
import {contextLabels,difficultyLabels,formatDate,goalLabels,kindLabels,modeLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';
import {sourceKind} from '../preview/source';
import {RunResult} from '../runs/RunResult';

type Source=z.infer<typeof PreviewSource>;type Level=z.infer<typeof Difficulty>;

export function SessionPage({id}:{id:string}) {
  const detail=useAsync(signal=>api('session',{id},{signal}),[id]);
  const [draft,setDraft]=useState('');const [answer,setAnswer]=useState('');const [level,setLevel]=useState<Level>('calm');
  const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);const [confirmDelete,setConfirmDelete]=useState(false);
  if(detail.loading&&!detail.data)return <Loading label="Загружаем ситуацию"/>;
  if(!detail.data)return <Notice tone="error" action={<Button variant="secondary" onClick={detail.reload}>Повторить</Button>}>{errorText(detail.error)}</Notice>;
  const s=detail.data,i=s.input;
  const current=s.runs.items.filter(r=>r.revision===s.revision);
  const main=current.find(r=>r.kind===sourceKind(i.mode));
  const analysed=main?.kind==='analysis'&&main.status==='succeeded';
  const exercise=current.find(r=>r.kind==='exercise'&&r.status==='succeeded');
  const preview=async(name:string,source:Source)=>{
    setBusy(name);setError(null);
    try{const p=await api('createPreview',source,{key:newKey()});navigate(`/previews/${p.id}`);}
    catch(e){setError(errorText(e));setBusy(null);}
  };
  const remove=async()=>{
    setBusy('delete');setError(null);
    try{await api('deleteSession',{id:s.id,expectedRevision:s.revision},{key:newKey()});navigate('/history',{replace:true});}
    catch(e){setError(errorText(e));setBusy(null);setConfirmDelete(false);detail.reload();}
  };
  const body=i.mode==='understand'?<p className="message">{i.message}</p>:i.mode==='thread'?<ol className="turns">{i.turns.map(t=><li key={t.id} className={`turn turn-${t.speaker}`}><strong>{t.speaker==='self'?'Я':'Собеседник'}</strong><span>{t.text}</span><span/></li>)}</ol>:<p className="message">{i.draft}</p>;
  const base={sessionId:s.id,expectedRevision:s.revision};
  return (
    <>
      <div className="page-head"><h1>{i.title}</h1><Button variant="danger" onClick={()=>setConfirmDelete(true)}>Удалить</Button></div>
      <p className="small muted">{modeLabels[i.mode]} · обновлено {formatDate(s.updatedAt)} · версия {s.revision}</p>
      {body}
      <dl className="meta"><dt>Собеседник</dt><dd>{i.relationship}</dd><dt>Сфера</dt><dd>{contextLabels[i.contextType]}</dd><dt>Цель</dt><dd>{goalLabels[i.goal]}</dd>{i.context&&<><dt>Контекст</dt><dd>{i.context}</dd></>}{i.mode==='say_direct'&&i.intent&&<><dt>Что выразить</dt><dd>{i.intent}</dd></>}</dl>
      {error&&<Notice tone="error">{error}</Notice>}
      <section className="card">
        <h2>Результат</h2>
        {!main&&<><p>Разбор ещё не запускался.</p><Button busy={busy==='main'} onClick={()=>void preview('main',{kind:sourceKind(i.mode),...base})}>Подготовить предпросмотр</Button></>}
        {main?.status==='pending'&&<p><Link to={`/runs/${main.id}`}>Запрос выполняется — открыть</Link></p>}
        {main?.status==='failed'&&<p><Link to={`/runs/${main.id}`}>Не удалось — открыть и повторить</Link></p>}
        {main?.status==='succeeded'&&<><RunResult run={main}/><p><Link to={`/runs/${main.id}`}>Открыть с подсветкой и оценкой</Link></p></>}
      </section>
      {analysed&&<section className="card">
        <h2>Практика по этой ситуации</h2>
        <TextArea label="Ваш черновик ответа" hint="Сначала свой вариант — так полезнее." value={draft} maxLength={3000} counter={{value:draft.length,max:3000}} onChange={e=>setDraft(e.target.value)}/>
        <div className="actions">
          <Button busy={busy==='reply'} disabled={!draft.trim()} onClick={()=>void preview('reply',{kind:'reply_feedback',...base,draft:draft.trim()})}>Разобрать черновик</Button>
          <Button variant="secondary" busy={busy==='examples'} onClick={()=>void preview('examples',{kind:'reply_examples',...base})}>Нужен пример</Button>
          <Button variant="secondary" busy={busy==='clarify'} onClick={()=>void preview('clarify',{kind:'clarify',...base})}>Ещё уточняющие вопросы</Button>
        </div>
        <h3>Упражнение 30–60 секунд</h3>
        {exercise&&exercise.kind==='exercise'&&exercise.status==='succeeded'?<>
          <RunResult run={exercise}/>
          <TextArea label="Ваша попытка" value={answer} maxLength={3000} onChange={e=>setAnswer(e.target.value)}/>
          <div className="actions"><Button busy={busy==='answer'} disabled={!answer.trim()} onClick={()=>void preview('answer',{kind:'exercise_feedback',...base,exerciseRunId:exercise.id,answer:answer.trim()})}>Получить отзыв</Button>
          <Button variant="secondary" busy={busy==='exercise'} onClick={()=>void preview('exercise',{kind:'exercise',...base})}>Другое упражнение</Button></div>
        </>:<Button variant="secondary" busy={busy==='exercise'} onClick={()=>void preview('exercise',{kind:'exercise',...base})}>Получить упражнение</Button>}
        <h3>Тренировка разговора</h3>
        <p className="small muted">Три ваших ответа, закончить можно после первого.</p>
        <div className="row"><div className="field"><label htmlFor="level">Собеседник</label><select id="level" value={level} onChange={e=>setLevel(e.target.value as Level)}>{Object.entries(difficultyLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          <Button variant="secondary" busy={busy==='role'} onClick={()=>void preview('role',{kind:'roleplay_start',...base,difficulty:level})}>Начать тренировку</Button></div>
        {s.roleplays.items.length>0&&<ul>{s.roleplays.items.map(r=><li key={r.id}><Link to={`/roleplays/${r.id}`}>{difficultyLabels[r.difficulty]} · {r.status==='active'?`ответов ${r.turnCount}/3 — продолжить`:'завершена'}</Link></li>)}</ul>}
      </section>}
      {current.length>0&&<section className="card"><h2>Все запросы этой версии</h2><ul>{current.map(r=><li key={r.id}><Link to={`/runs/${r.id}`}>{kindLabels[r.kind]}</Link> · {r.status==='succeeded'?'готово':r.status==='failed'?'не удалось':'выполняется'}</li>)}</ul></section>}
      <Modal open={confirmDelete} title="Удалить ситуацию?" onClose={()=>setConfirmDelete(false)} actions={<><Button variant="danger" busy={busy==='delete'} onClick={()=>void remove()}>Удалить</Button><Button variant="secondary" onClick={()=>setConfirmDelete(false)}>Отмена</Button></>}>
        <p>Удалятся ситуация, разборы и практика по ней — и на сайте, и в боте. Сообщения в чате Telegram останутся, их можно удалить только в Telegram.</p>
      </Modal>
    </>
  );
}

export function RoleplayPage({id}:{id:string}) {
  const role=useAsync(signal=>api('roleplay',{id},{signal}),[id]);
  const [text,setText]=useState('');const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
  if(!role.data)return role.loading?<Loading label="Загружаем тренировку"/>:<Notice tone="error">{errorText(role.error)}</Notice>;
  const r=role.data;
  const go=async(name:string,build:(revision:number)=>Source)=>{
    setBusy(name);setError(null);
    try{const s=await api('session',{id:r.sessionId});const p=await api('createPreview',build(s.revision),{key:newKey()});navigate(`/previews/${p.id}`);}
    catch(e){setError(errorText(e));setBusy(null);}
  };
  return (
    <>
      <h1>Тренировка разговора</h1>
      <p className="muted">Собеседник: {difficultyLabels[r.difficulty]} · ответов {r.turnCount} из 3</p>
      <p><Link to={`/sessions/${r.sessionId}`}>← К ситуации</Link></p>
      <ul className="chat">{r.messages.map(m=><li key={m.id} className={`from-${m.role}`}><span className="sr-only">{m.role==='user'?'Вы':'Собеседник'}: </span>{m.content}</li>)}</ul>
      {r.status==='completed'&&r.feedback&&<section className="card"><h2>Итог</h2><RunResult run={{kind:'roleplay_feedback',status:'succeeded',output:r.feedback} as never}/></section>}
      {r.status==='active'&&<>
        {error&&<Notice tone="error">{error}</Notice>}
        <TextArea label={`Ваш ответ ${r.turnCount+1} из 3`} value={text} maxLength={3000} onChange={e=>setText(e.target.value)} disabled={r.turnCount>=3}/>
        <div className="actions">
          <Button busy={busy==='turn'} disabled={!text.trim()||r.turnCount>=3} onClick={()=>void go('turn',rev=>({kind:'roleplay_turn',roleplayId:r.id,expectedRevision:rev,content:text.trim()}))}>Ответить</Button>
          {r.turnCount>0&&<Button variant="secondary" busy={busy==='finish'} onClick={()=>void go('finish',rev=>({kind:'roleplay_feedback',roleplayId:r.id,expectedRevision:rev}))}>Завершить и получить итог</Button>}
        </div>
      </>}
    </>
  );
}
