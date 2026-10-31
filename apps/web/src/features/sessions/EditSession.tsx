import {useRef,useState} from 'react';
import type {z} from 'zod';
import {SessionInputV2,type ContextType,type Goal,type SessionV2} from '@between/contracts/product';
import {Button,Notice,TextArea,TextField} from '../../components/ui';
import {api,errorText,isApiError,newKey} from '../../lib/api';
import {contextLabels,goalLabels} from '../../lib/labels';

type Input=z.infer<typeof SessionInputV2>;type Ctx=z.infer<typeof ContextType>;type GoalValue=z.infer<typeof Goal>;

/**
 * Edits the saved situation with expectedRevision. A change from the bot or another tab yields REVISION_CONFLICT:
 * the user's edits stay on screen and nothing is overwritten silently. A new revision needs a new preview/analysis.
 */
export function EditSession({session,onSaved,onCancel}:{session:z.infer<typeof SessionV2>;onSaved():void;onCancel():void}) {
  const [input,setInput]=useState<Input>(structuredClone(session.input));
  const [emotions,setEmotions]=useState('guess' in session.input?session.input.guess.emotions.join(', '):'');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [conflict,setConflict]=useState(false);
  const key=useRef(newKey());
  const set=(patch:Partial<Input>)=>{key.current=newKey();setInput({...input,...patch} as Input);};
  const save=async()=>{
    setError(null);setConflict(false);
    const next='guess' in input?{...input,guess:{...input.guess,emotions:input.guess.unsure?[]:emotions.split(',').map(x=>x.trim()).filter(Boolean)}}:input;
    const parsed=SessionInputV2.safeParse(next);
    if(!parsed.success){setError('Проверьте поля: длина, не больше 3 эмоций, цитаты точно из текста.');return;}
    setBusy(true);
    try{await api('updateSession',{id:session.id,expectedRevision:session.revision,input:parsed.data},{key:key.current});onSaved();}
    catch(e){if(isApiError(e,'REVISION_CONFLICT'))setConflict(true);else setError(errorText(e));}
    finally{setBusy(false);}
  };
  return (
    <form className="card grid-form" aria-label="Изменить ситуацию" onSubmit={e=>{e.preventDefault();void save();}}>
      <h2>Изменить ситуацию</h2>
      <Notice>После сохранения появится новая версия: прежние разборы останутся в истории, для новой версии нужен новый предпросмотр.</Notice>
      <TextField label="Название" value={input.title} maxLength={200} onChange={e=>set({title:e.target.value})}/>
      {input.mode==='understand'&&<TextArea label="Сообщение" value={input.message} maxLength={6000} onChange={e=>set({message:e.target.value})}/>}
      {(input.mode==='say_direct'||input.mode==='before_send')&&<TextArea label="Мой текст" value={input.draft} maxLength={6000} onChange={e=>set({draft:e.target.value})}/>}
      {input.mode==='say_direct'&&<TextField label="Что хочу выразить" value={input.intent} maxLength={1000} onChange={e=>set({intent:e.target.value})}/>}
      {input.mode==='thread'&&input.turns.map((t,i)=><TextArea key={t.id} label={`Реплика ${i+1} (${t.speaker==='self'?'я':'собеседник'})`} value={t.text} maxLength={3000} onChange={e=>set({turns:input.turns.map(x=>x.id===t.id?{...x,text:e.target.value}:x)})}/>)}
      <TextField label="Кто этот человек" value={input.relationship} maxLength={200} onChange={e=>set({relationship:e.target.value})}/>
      <div className="row">
        <div className="field"><label htmlFor="edit-context-type">Сфера</label><select id="edit-context-type" value={input.contextType} onChange={e=>set({contextType:e.target.value as Ctx})}>{Object.entries(contextLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="edit-goal">Цель</label><select id="edit-goal" value={input.goal} onChange={e=>set({goal:e.target.value as GoalValue})}>{Object.entries(goalLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <TextArea label="Контекст" value={input.context} maxLength={4000} onChange={e=>set({context:e.target.value})}/>
      {'guess' in input&&<fieldset><legend>Моя версия</legend>
        <label className="checkbox"><input type="checkbox" checked={input.guess.unsure} onChange={e=>set({guess:{...input.guess,unsure:e.target.checked,...(e.target.checked?{quotes:[]}:{})}} as Partial<Input>)}/>Не понимаю</label>
        {!input.guess.unsure&&<TextField label="Эмоции (до 3, через запятую)" value={emotions} onChange={e=>{key.current=newKey();setEmotions(e.target.value);}}/>}
        {input.guess.quotes.length>0&&<p className="small muted">Цитаты: {input.guess.quotes.map(q=>`«${q}»`).join(', ')} — должны оставаться в тексте.</p>}
      </fieldset>}
      {conflict&&<Notice tone="error" title="Ситуация изменилась в боте или другом окне">Ваши правки не потеряны — они на экране. Откройте актуальную версию, чтобы сравнить и применить их заново.</Notice>}
      {error&&<Notice tone="error">{error}</Notice>}
      <div className="actions"><Button type="submit" busy={busy}>Сохранить новую версию</Button><Button variant="secondary" onClick={onCancel}>Отмена</Button>{conflict&&<Button variant="secondary" onClick={onSaved}>Открыть актуальную версию</Button>}</div>
    </form>
  );
}
