import {useEffect,useRef,useState} from 'react';
import type {z} from 'zod';
import type {Preview} from '@between/contracts/product';
import {Link,navigate} from '../../app/router';
import {Button,Loading,Notice} from '../../components/ui';
import {api,errorText,newKey} from '../../lib/api';
import {kindLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';
import {saveDialogue,type Dialogue} from '../../lib/dialogue';
import {AssessmentPending} from '../../components/AssessmentPending';
import {isApiError} from '../../lib/api';
import {recordStage} from '../../lib/stage';

type Pv=z.infer<typeof Preview>;

/** Verified contacts only for the region the user chose explicitly; no country is guessed. */
function Support() {
  const s=useAsync(signal=>api('support',{},{signal}),[]);
  if(s.loading)return <Loading label="Загружаем"/>;
  if(!s.data)return <Notice tone="error">{errorText(s.error)}</Notice>;
  const d=s.data;
  return (
    <Notice tone="error" title="Похоже, ситуация может быть опасной">
      <p>{d.message}</p>
      {d.availability==='available'&&<ul>{d.contacts.map(c=><li key={c.label}>{c.label}{c.phone?`: ${c.phone}`:''} {c.url&&<a href={c.url} rel="noopener noreferrer">{c.url}</a>} <span className="small muted">(проверено {new Date(c.verifiedAt).toLocaleDateString('ru-RU')})</span></li>)}</ul>}
      {d.availability==='region_required'&&<p>Чтобы показать проверенные местные контакты, укажите страну в <Link to="/settings">настройках</Link>. Без этого номеров не будет — мы их не придумываем.</p>}
      {d.availability==='unavailable'&&<p>Проверенных контактов для вашего региона пока нет.</p>}
      <p className="small">Сервис может не распознать опасность и не может позвать помощь за вас. Обычный разбор здесь отложен.</p>
    </Notice>
  );
}

/** Exact masked snapshot from the server. Editing creates a new revision; only a confirmed current hash starts a run. */
export function PreviewPage({id}:{id:string}) {
  const loaded=useAsync(signal=>api('preview',{id},{signal}),[id]);
  const [preview,setPreview]=useState<Pv|null>(null);
  const [edits,setEdits]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<'save'|'send'|null>(null);const [error,setError]=useState<string|null>(null);
  const keys=useRef({edit:newKey(),confirm:newKey(),start:newKey()});
  useEffect(()=>{if(loaded.data){setPreview(loaded.data);setEdits({});}},[loaded.data]);
  const [shown,setShown]=useState(false);
  const [pending,setPending]=useState<Dialogue|null>(null);const [bind,setBind]=useState(0);
  useEffect(()=>{
    if(!preview)return;let cancelled=false;setShown(false);
    void api('dialogue',{}).then(d=>saveDialogue(d,{step:'preview',sessionId:preview.sessionId,previewId:preview.id,roleplayId:preview.dependencies.find(dep=>dep.kind==='roleplay')?.id??null,navigation:{kind:'preview',previewId:preview.id,previewRevision:preview.revision,snapshotHash:preview.snapshotHash}})).then(()=>{if(!cancelled)setShown(true);},async e=>{
      if(cancelled)return;
      // A saved unfinished test blocks binding this preview: offer to continue or reset it, never discard silently.
      if(isApiError(e,'REVISION_CONFLICT')){const d=await api('dialogue',{}).catch(()=>null);if(!cancelled&&d?.navigation.kind==='assessment'){setPending(d);return;}}
      setError(errorText(e));
    });
    return ()=>{cancelled=true;};
  },[preview,bind]);
  if(loaded.loading&&!preview)return <Loading label="Готовим предпросмотр"/>;
  if(!preview)return <Notice tone="error" action={<Button variant="secondary" onClick={loaded.reload}>Повторить</Button>}>{errorText(loaded.error)}</Notice>;
  const dirty=Object.entries(edits).some(([fieldId,value])=>preview.fields.find(f=>f.id===fieldId)?.value!==value);
  const tooLarge=preview.budget.fit==='too_large',fits=preview.budget.fit==='fits';
  const save=async()=>{
    setBusy('save');setError(null);
    try{
      const changed=Object.entries(edits).filter(([fieldId,value])=>preview.fields.find(f=>f.id===fieldId)?.value!==value).map(([fieldId,value])=>({fieldId,value}));
      const next=await api('editPreview',{id:preview.id,expectedRevision:preview.revision,edits:changed},{key:keys.current.edit});
      setPreview(next);setEdits({});keys.current={edit:newKey(),confirm:newKey(),start:newKey()};
    }catch(e){setError(errorText(e));}finally{setBusy(null);}
  };
  const send=async()=>{
    setBusy('send');setError(null);
    try{
      const receipt=await api('confirmPreview',{id:preview.id,expectedRevision:preview.revision,snapshotHash:preview.snapshotHash},{key:keys.current.confirm});
      recordStage('preview_confirmed',{resourceId:preview.id});
      const run=await api('startRun',{previewId:preview.id,previewRevision:receipt.revision,snapshotHash:receipt.snapshotHash,expectedSessionRevision:preview.sessionRevision},{key:keys.current.start});
      navigate(`/runs/${run.runId}`,{replace:true});
    }catch(e){setError(errorText(e));setBusy(null);}
  };
  const order=new Map(preview.turns.map(t=>[t.fieldId,t]));
  return (
    <>
      <h1>Проверьте, что уйдёт в модель</h1>
      <p className="muted">{kindLabels[preview.kind]} · версия предпросмотра {preview.revision}</p>
      {pending&&<AssessmentPending dialogue={pending} onResolved={()=>{setPending(null);setBind(n=>n+1);}}/>}
      {preview.safety==='support'&&<Support/>}
      <Notice>{preview.redactionCount?`Автоматически скрыто телефонов и почт: ${preview.redactionCount}. `:'Телефонов и почт не найдено. '}Имена и адреса проверьте сами. Это помощь, а не гарантия анонимности. Данные проходят через сервер проекта и обрабатываются моделью на компьютере команды.</Notice>
      <form className="grid-form" onSubmit={e=>{e.preventDefault();void save();}}>
        {preview.fields.map((f,n)=>{const turn=order.get(f.id);const label=`${n+1}. ${f.label}${turn?(turn.speaker==='self'?' (я)':' (собеседник)'):''}`;
          return f.editable?(
            <div className="field" key={f.id}><label htmlFor={`f-${f.id}`}>{label}</label><textarea id={`f-${f.id}`} value={edits[f.id]??f.value} maxLength={12000} onChange={e=>setEdits({...edits,[f.id]:e.target.value})}/></div>
          ):(
            <div className="field" key={f.id}><span className="field-label"><strong>{label}</strong> <span className="small muted">только чтение</span></span><p className="message">{f.value||'—'}</p></div>
          );})}
        {dirty&&<div className="actions"><Button type="submit" variant="secondary" busy={busy==='save'} disabled={!shown}>Сохранить правки и обновить предпросмотр</Button></div>}
      </form>
      <p className="small muted">Бюджет модели: ввод {preview.budget.inputTokens}, ответ до {preview.budget.maxOutputTokens}, окно {preview.budget.contextWindow} токенов{preview.budget.fit==='unknown'?' — проверить заранее не удалось':''}.</p>
      {tooLarge&&<Notice tone="error">Текст не помещается в контекст модели. Сократите поля — обрезать молча не будем.</Notice>}
      {preview.budget.fit==='unknown'&&<Notice tone="error">Размер текста для модели не удалось проверить — отправка недоступна. Сократите текст или попробуйте позже.</Notice>}
      {error&&<Notice tone="error">{error}</Notice>}
      {preview.safety!=='support'&&<div className="actions">
        <Button busy={busy==='send'} disabled={dirty||!fits||!shown||busy!==null} onClick={()=>void send()}>Отправить в модель</Button>
        {dirty&&<span className="small muted">Сначала сохраните правки — подтверждается только актуальная версия.</span>}
      </div>}
    </>
  );
}
