import {useState} from 'react';
import {Link,navigate} from '../../app/router';
import {Button,Loading,Notice} from '../../components/ui';
import {api,errorText,newKey} from '../../lib/api';
import {kindLabels,runFailure} from '../../lib/labels';
import {useAsync,usePoll} from '../../lib/useAsync';
import {RunResult,Usefulness} from './RunResult';

/** Bounded polling of one run; stops on leave. Restoring after refresh is just reopening this URL. */
export function RunPage({id}:{id:string}) {
  const state=usePoll(signal=>api('run',{id},{signal}),run=>run.status!=='pending',[id]);
  const run=state.data;
  const preview=useAsync(async signal=>run&&run.status==='succeeded'?api('preview',{id:run.previewId},{signal}).catch(()=>null):null,[run?.status,run?.previewId]);
  const [retryError,setRetryError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  if(!run)return state.error?<Notice tone="error">{errorText(state.error)}</Notice>:<Loading label="Загружаем результат"/>;
  const retry=async()=>{
    if(run.status!=='failed')return;setBusy(true);setRetryError(null);
    try{
      // Retry is bound to the confirmed snapshot of this run; a changed preview is reported as PREVIEW_STALE.
      const preview=await api('preview',{id:run.previewId});
      const next=await api('retry',{id:run.id,previewId:run.previewId,previewRevision:run.previewRevision,snapshotHash:preview.snapshotHash,expectedRevision:run.revision},{key:newKey()});navigate(`/runs/${next.runId}`,{replace:true});}
    catch(e){setRetryError(errorText(e));setBusy(false);}
  };
  return (
    <>
      <h1>{kindLabels[run.kind]}</h1>
      {run.sessionId&&<p><Link to={`/sessions/${run.sessionId}`}>← К ситуации</Link></p>}
      {run.status==='pending'&&<><Loading label={run.phase==='queued'?`В очереди${run.queuePosition?`: место ${run.queuePosition}`:''}`:'Модель отвечает'}/>{state.timedOut&&<Notice>Ответ задерживается. Можно уйти со страницы — результат сохранится в истории и придёт в бот.</Notice>}{state.error!==undefined&&<Notice tone="error">{errorText(state.error)}</Notice>}</>}
      {run.status==='failed'&&<Notice tone="error" title="Не удалось получить ответ" action={run.errorCode!=='PREVIEW_STALE'&&run.errorCode!=='INPUT_TOO_LARGE'?<Button variant="secondary" busy={busy} onClick={()=>void retry()}>Повторить</Button>:undefined}>{runFailure[run.errorCode]} Сохранённые данные не потеряны.{retryError&&<p>{retryError}</p>}</Notice>}
      {run.status==='succeeded'&&<><RunResult run={run} preview={preview.data}/><Usefulness runId={run.id} myRating={run.myRating}/></>}
    </>
  );
}
