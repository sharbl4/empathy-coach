import {useState} from 'react';
import {Link} from '../app/router';
import {api,errorText,newKey} from '../lib/api';
import type {Dialogue} from '../lib/dialogue';
import {Modal} from './Modal';
import {Button,Notice} from './ui';

/** A saved unfinished test blocks other scenarios in the shared dialogue: continue it or reset it after confirmation. */
export function AssessmentPending({dialogue,onResolved}:{dialogue:Dialogue;onResolved(next:Dialogue):void}) {
  const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const reset=async()=>{setBusy(true);setError(null);
    try{onResolved(await api('resetDialogue',{expectedRevision:dialogue.revision,confirmation:'DISCARD_UNFINISHED_ASSESSMENT'},{key:newKey()}));setOpen(false);}
    catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return (
    <Notice tone="error" title="Есть незавершённый тест до/после" action={<><Link className="btn btn-secondary" to="/practice">Продолжить тест</Link><Button variant="secondary" onClick={()=>setOpen(true)}>Сбросить тест</Button></>}>
      <p>Ответы теста сохранены (возможно, в боте). Пока тест не завершён или не сброшен, этот черновик не сохраняется на сервере — введённое остаётся на странице.</p>
      {error&&<p>{error}</p>}
      <Modal open={open} title="Сбросить ответы теста?" onClose={()=>setOpen(false)} actions={<><Button variant="secondary" onClick={()=>setOpen(false)}>Продолжить тест</Button><Button busy={busy} onClick={()=>void reset()}>Да, сбросить тест</Button></>}>
        <p>Сохранённые ответы будут удалены только после подтверждения.</p>
      </Modal>
    </Notice>
  );
}
