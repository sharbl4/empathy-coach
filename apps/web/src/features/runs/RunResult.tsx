import {useState} from 'react';
import type {z} from 'zod';
import type {Preview,RunV2} from '@between/contracts/product';
import {Highlighted,type Span} from '../../components/Highlighted';
import {Button,Notice} from '../../components/ui';
import {api,errorText,newKey} from '../../lib/api';
import {basisLabels,goalLabels,skillLabels,toneLabels,toneMarks} from '../../lib/labels';

type Run=z.infer<typeof RunV2>;type Pv=z.infer<typeof Preview>;
type Done=Extract<Run,{status:'succeeded'}>;

const List=({items}:{items:string[]})=>items.length?<ul>{items.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="muted">—</p>;

function Goals({items}:{items:{goal:keyof typeof goalLabels;text:string;explanation:string}[]}) {
  return <dl className="goals">{items.map(o=><div key={o.goal}><dt><strong>{goalLabels[o.goal]}</strong></dt><dd><p className="message">{o.text}</p><p className="small muted">{o.explanation}</p></dd></div>)}</dl>;
}

/** Renders a validated run output. Model text is plain React text only. */
export function RunResult({run,preview}:{run:Done;preview?:Pv|null}) {
  const fields=new Map(preview?.fields.map(f=>[f.id,f])??[]);
  switch(run.kind){
    case 'analysis':{
      const a=run.output;
      const byField=new Map<string,Span[]>();
      a.interpretations.forEach((i,n)=>i.evidence.forEach(e=>{const list=byField.get(e.fieldId)??[];list.push({quote:e.quote,label:`Трактовка ${n+1}: ${i.emotion}`,detail:<p className="small">{i.explanation}</p>});byField.set(e.fieldId,list);}));
      return (
        <section className="analysis" aria-label="Разбор">
          <p><strong>Буквально:</strong> {a.literalMeaning}</p>
          {[...byField].map(([fieldId,spans])=>fields.get(fieldId)&&<Highlighted key={fieldId} text={fields.get(fieldId)!.value} spans={spans} title={`Опора в тексте · ${fields.get(fieldId)!.label}`}/>)}
          <h3>Возможные трактовки</h3>
          <p className="small muted">Это гипотезы, а не факты. Категория оснований — оценка модели, не вероятность чувства.</p>
          <ol className="interpretations">{a.interpretations.map((i,n)=><li key={n} className="interpretation">
            <p><strong>{i.emotion}</strong> → возможная потребность: {i.possibleNeed}<span className="badge">{basisLabels[i.basis]}</span></p>
            <p>{i.explanation}</p>
            <p className="small muted">{i.evidence.length?`Цитаты: ${i.evidence.map(e=>`«${e.quote}»`).join(', ')}`:'Прямых слов в тексте нет — это предположение.'}</p>
          </li>)}</ol>
          <h3>Что неизвестно</h3><p>{a.uncertainty}</p>
          <h3>Твоя версия и другие версии</h3>
          <p className="small muted">Совпадение с разбором не означает «правильно» — это ещё одна гипотеза.</p>
          <p><strong>Где совпало:</strong></p><List items={a.comparison.matches}/>
          <p><strong>Другие возможные версии:</strong></p><List items={a.comparison.alternatives}/>
          <p><strong>Что уточнить:</strong></p><List items={a.comparison.toClarify}/>
          <h3>Как уточнить</h3><p className="question">{a.clarifyingQuestion}</p>
          <p><strong>Совет:</strong> {a.skillTip}</p>
        </section>
      );
    }
    case 'reply_feedback':case 'before_send':{
      const f=run.output;
      const byField=new Map<string,Span[]>();
      f.phrases.forEach((p,n)=>{const list=byField.get(p.fieldId)??[];list.push({quote:p.quote,tone:p.tone,label:`${toneMarks[p.tone]} ${toneLabels[p.tone]}`,detail:<><p className="small">Как может прозвучать: {p.why}</p><p className="small">Вариант мягче: «{p.softer}»</p></>});byField.set(p.fieldId,list);void n;});
      return (
        <section aria-label="Разбор черновика">
          <p className="small muted">Это возможное восприятие фраз, не оценка тебя. Нажми на отмеченное место, чтобы увидеть пояснение.</p>
          {[...byField].map(([fieldId,spans])=>fields.get(fieldId)&&<Highlighted key={fieldId} text={fields.get(fieldId)!.value} spans={spans} title={fields.get(fieldId)!.label}/>)}
          <h3>Сильные стороны</h3><List items={f.strengths}/>
          <h3>Фразы</h3>
          <ol>{f.phrases.map((p,n)=><li key={n}><p>{toneMarks[p.tone]} <strong>{toneLabels[p.tone]}</strong>: «{p.quote}»</p><p className="small">Как может прозвучать: {p.why}</p><p className="small">Возможная замена: «{p.softer}»</p></li>)}</ol>
          <h3>Вариант доработки</h3><p className="message">{f.revisedReply}</p>
          <h3>Примеры под разные цели</h3><Goals items={f.options}/>
        </section>
      );
    }
    case 'reply_examples':return <section aria-label="Примеры"><Goals items={run.output}/></section>;
    case 'say_direct':{const d=run.output;return (
      <section aria-label="Сказать прямо">
        <ol>{d.variants.map((v,i)=><li key={i}><p className="message">{v.text}</p><p className="small muted">{v.explanation}</p></li>)}</ol>
        <p><strong>Что сохранено:</strong> {d.preservedMeaning}</p>
        {d.changeNotes.length>0&&<><p><strong>Что изменено:</strong></p><List items={d.changeNotes}/></>}
        <p className="small muted">Это варианты твоей формулировки, а не определение чьих-то намерений.</p>
      </section>);}
    case 'clarify':return <section><List items={run.output.questions}/><p className="small">{run.output.explanation}</p></section>;
    case 'exercise':return <section><p><span className="badge">{skillLabels[run.output.skill]}</span> · 30–60 секунд</p><p>{run.output.instruction}</p><p className="small muted">Подсказка: {run.output.exampleHint}</p></section>;
    case 'exercise_feedback':case 'card_feedback':{const f=run.output;return <section><h3>Что получилось</h3><List items={f.strengths}/><h3>Что улучшить</h3><p>{f.improvement}</p><h3>Как могло бы звучать</h3><p className="message">{f.suggestedAttempt}</p></section>;}
    case 'roleplay_start':case 'roleplay_turn':case 'roleplay_feedback':{
      const o=run.output;
      if(o.kind==='message')return <section><p className="small muted">Собеседник:</p><p className="message">{o.content}</p></section>;
      return <section><h3>Удачные действия</h3><List items={o.strengths}/><h3>Что можно попробовать</h3><List items={o.improvements}/><p><strong>Следующий навык:</strong> {o.nextPractice}</p></section>;
    }
  }
}

/** Own-run usefulness vote; changing the value updates the same vote, double clicks do not add one. */
export function Usefulness({runId}:{runId:string}) {
  const [value,setValue]=useState<'useful'|'not_useful'|null>(null);
  const [error,setError]=useState<string|null>(null);
  const vote=async(next:'useful'|'not_useful')=>{
    setError(null);
    try{const v=await api('rateRun',{runId,value:next},{key:newKey()});setValue(v.value);}catch(e){setError(errorText(e));}
  };
  return (
    <div className="actions" role="group" aria-label="Оценка полезности">
      <Button variant="secondary" aria-pressed={value==='useful'} onClick={()=>void vote('useful')}>Полезно</Button>
      <Button variant="secondary" aria-pressed={value==='not_useful'} onClick={()=>void vote('not_useful')}>Не полезно</Button>
      {value&&<span className="small muted" aria-live="polite">Отмечено: {value==='useful'?'полезно':'не полезно'}. Можно изменить.</span>}
      {error&&<Notice tone="error">{error}</Notice>}
    </div>
  );
}
