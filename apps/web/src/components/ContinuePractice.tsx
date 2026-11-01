import {useState} from 'react';
import {Link} from '../app/router';
import {api,errorText,newKey} from '../lib/api';
import {useAsync} from '../lib/useAsync';
import type {Dialogue} from '../lib/dialogue';
import {Button,Notice} from './ui';
import {Modal} from './Modal';

function destination(d:Dialogue):string|null {
  if(d.navigation.kind==='assessment')return '/practice?assessment='+d.navigation.assessmentKind;
  if(d.previewId&&d.step==='preview')return '/previews/'+d.previewId;
  if(d.roleplayId&&d.step==='roleplay')return '/roleplays/'+d.roleplayId;
  if(d.navigation.kind==='card')return '/practice?card='+encodeURIComponent(d.navigation.cardId);
  if(d.step==='waiting_run'&&d.pendingRunId)return '/runs/'+d.pendingRunId;
  if(d.sessionId&&['exercise','roleplay','compose'].includes(d.step))return '/sessions/'+d.sessionId;
  if(['compose','guess'].includes(d.step)&&d.draft.mode)return '/new';
  return null;
}
/** Reads the canonical expiring server dialogue. Opening this notice never starts generation. */
export function ContinuePractice() {
  const state=useAsync(signal=>api('dialogue',{},{signal}),[]);
  const [confirm,setConfirm]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const d=state.data,href=d?destination(d):null;
  const reset=async()=>{if(!d)return;setBusy(true);setError(null);try{await api('resetDialogue',{expectedRevision:d.revision,...(d.navigation.kind==='assessment'?{confirmation:'DISCARD_UNFINISHED_ASSESSMENT' as const}:{})},{key:newKey()});setConfirm(false);state.reload();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  if(!href)return state.error?<Notice tone="error">Не удалось проверить сохранённую практику. {errorText(state.error)}</Notice>:null;
  return <section className="card" aria-label="Продолжить практику"><h2>Продолжить</h2><p>Незавершённая практика сохранена на сервере и доступна в Telegram. Черновики хранятся до часа бездействия, максимум сутки.</p><div className="actions"><Link className="btn btn-primary" to={href}>Продолжить практику</Link>{d?.step!=='waiting_run'&&<Button variant="secondary" onClick={()=>setConfirm(true)}>Сбросить практику</Button>}</div>{error&&<Notice tone="error">{error}</Notice>}<Modal open={confirm} title="Сбросить незавершённую практику?" onClose={()=>setConfirm(false)} actions={<><Button variant="danger" busy={busy} onClick={()=>void reset()}>Да, сбросить практику</Button><Button variant="secondary" onClick={()=>setConfirm(false)}>Продолжить</Button></>}><p>Сохранённые разборы останутся в истории. Незавершённые ответы будут удалены только после подтверждения.</p></Modal></section>;
}
