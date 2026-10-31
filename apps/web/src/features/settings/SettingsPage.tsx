import {useEffect,useState} from 'react';
import type {z} from 'zod';
import type {EmailVerificationStatus,ReminderSettings} from '@between/contracts/product';
import {navigate} from '../../app/router';
import {Modal} from '../../components/Modal';
import {Button,Loading,Notice,TextField} from '../../components/ui';
import {api,auth,errorText,newKey} from '../../lib/api';
import {formatDate} from '../../lib/labels';
import {useSession} from '../../lib/session';
import {useAsync} from '../../lib/useAsync';

type Reminders=z.infer<typeof ReminderSettings>;
type Verification=z.infer<typeof EmailVerificationStatus>;
const POLICY='web-telegram-2';

function RemindersForm() {
  const loaded=useAsync(signal=>api('reminders',{},{signal}),[]);
  const [r,setR]=useState<Reminders|null>(null);const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{tone:'success'|'error';text:string}|null>(null);
  useEffect(()=>{if(loaded.data)setR(loaded.data);},[loaded.data]);
  if(!r)return loaded.loading?<Loading label="Загружаем напоминания"/>:<Notice tone="error">{errorText(loaded.error)}</Notice>;
  const save=async()=>{setBusy(true);setMsg(null);
    try{const next=await api('updateReminders',{expectedRevision:r.revision,enabled:r.enabled,timezone:r.timezone,localTime:r.localTime,quietHours:r.quietHours},{key:newKey()});setR(next);setMsg({tone:'success',text:'Сохранено.'});}
    catch(e){setMsg({tone:'error',text:errorText(e)});loaded.reload();}finally{setBusy(false);}};
  const browserZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <form className="grid-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <p className="small muted">Напоминания о практике дня приходят только в Telegram и только если вы их включили. Можно выключить в любой момент.</p>
      <label className="checkbox"><input type="checkbox" checked={r.enabled} onChange={e=>setR({...r,enabled:e.target.checked})}/>Присылать напоминание</label>
      <div className="row">
        <TextField label="Время (ЧЧ:ММ)" type="time" value={r.localTime} onChange={e=>setR({...r,localTime:e.target.value})}/>
        <TextField label="Часовой пояс (IANA)" hint={browserZone&&browserZone!==r.timezone?<button type="button" className="link-button" onClick={()=>setR({...r,timezone:browserZone})}>Взять пояс браузера: {browserZone}</button>:undefined} value={r.timezone} maxLength={100} onChange={e=>setR({...r,timezone:e.target.value})}/>
      </div>
      <label className="checkbox"><input type="checkbox" checked={r.quietHours.enabled} onChange={e=>setR({...r,quietHours:{...r.quietHours,enabled:e.target.checked}})}/>Тихие часы</label>
      {r.quietHours.enabled&&<div className="row"><TextField label="С" type="time" value={r.quietHours.start} onChange={e=>setR({...r,quietHours:{...r.quietHours,start:e.target.value}})}/><TextField label="До" type="time" value={r.quietHours.end} onChange={e=>setR({...r,quietHours:{...r.quietHours,end:e.target.value}})}/></div>}
      {msg&&<Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="actions"><Button type="submit" busy={busy}>Сохранить напоминания</Button></div>
    </form>
  );
}

const challengeText:Record<string,string>={sending:'Письмо отправляется.',sent:'Код отправлен.',delivery_unknown:'Не удалось подтвердить отправку письма. Если оно пришло — введите код.',failed:'Письмо не отправилось. Запросите код ещё раз.',expired:'Срок кода истёк.',locked:'Попытки ввода закончились.'};

/** Email change on the web: state is read from the server every time, never kept in browser storage. */
function EmailSection() {
  const loaded=useAsync(signal=>api('emailVerification',{},{signal}),[]);
  const {refresh}=useSession();
  const [status,setStatus]=useState<Verification|null>(null);
  const [email,setEmail]=useState('');const [code,setCode]=useState('');
  const [busy,setBusy]=useState<string|null>(null);const [msg,setMsg]=useState<{tone:'success'|'error';text:string}|null>(null);
  useEffect(()=>{if(loaded.data)setStatus(loaded.data);},[loaded.data]);
  const reread=async(text?:string,tone:'success'|'error'='error')=>{try{setStatus(await api('emailVerification',{}));}catch{/* keep last known */}if(text)setMsg({tone,text});};
  const run=async(name:string,work:()=>Promise<unknown>)=>{setBusy(name);setMsg(null);try{await work();}catch(e){await reread(errorText(e));}finally{setBusy(null);}};
  if(!status)return loaded.loading?<Loading label="Проверяем почту"/>:<Notice tone="error">{errorText(loaded.error)}</Notice>;
  const c=status.state==='challenge'?status.challenge:null;
  const wait=c?Math.max(0,Math.ceil((Date.parse(c.resendAfter)-Date.now())/1000)):0;
  return (
    <div className="grid-form">
      {status.state==='verified'&&<p>Почта подтверждена.</p>}
      {c&&<Notice>{challengeText[c.state]} Адрес: {c.maskedEmail}. Осталось попыток: {c.attemptsRemaining}. {wait?`Новый код — через ${wait} с.`:'Можно запросить новый код.'}</Notice>}
      {c&&['sent','delivery_unknown','sending'].includes(c.state)&&<form className="row" onSubmit={e=>{e.preventDefault();void run('verify',async()=>{await api('verifyEmailCode',{challengeId:c.challengeId,code},{key:newKey()});setCode('');await refresh();await reread('Почта подтверждена.','success');});}}>
        <TextField label="Код из письма" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/>
        <Button type="submit" busy={busy==='verify'} disabled={code.length!==6}>Подтвердить</Button>
      </form>}
      {c&&<div className="actions"><Button variant="secondary" busy={busy==='resend'} disabled={wait>0} onClick={()=>void run('resend',async()=>setStatus(await api('resendEmailCode',{challengeId:c.challengeId},{key:newKey()})))}>Отправить код ещё раз</Button></div>}
      <form className="row" onSubmit={e=>{e.preventDefault();void run('request',async()=>{setStatus(await api('requestEmailCode',{email:email.trim()},{key:newKey()}));setEmail('');});}}>
        <TextField label={status.state==='verified'?'Новый адрес почты':'Адрес почты'} type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/>
        <Button type="submit" variant="secondary" busy={busy==='request'} disabled={!email.trim()}>Получить код</Button>
      </form>
      <p className="small muted">История остаётся в этом аккаунте; смена адреса не объединяет аккаунты.</p>
      {msg&&<Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

function WebSessions() {
  const list=useAsync(signal=>auth('sessions',{limit:20},{signal}),[]);
  const {refresh}=useSession();const [error,setError]=useState<string|null>(null);
  const revoke=async(id?:string)=>{setError(null);
    try{if(id)await auth('revokeSession',{id},{key:newKey()});else await auth('revokeAllSessions',{},{key:newKey()});}catch(e){setError(errorText(e));}
    const s=await refresh();if(s&&!s.authenticated){navigate('/auth/login',{replace:true,force:true});return;}list.reload();};
  if(!list.data)return list.loading?<Loading label="Загружаем входы"/>:<Notice tone="error">{errorText(list.error)}</Notice>;
  return (
    <>
      <ul>{list.data.items.map(s=><li key={s.id}>{formatDate(s.createdAt)} — до {formatDate(s.expiresAt)}{s.isCurrent&&<span className="badge">это окно</span>} <Button variant="ghost" onClick={()=>void revoke(s.id)}>Завершить</Button></li>)}</ul>
      {error&&<Notice tone="error">{error}</Notice>}
      <Button variant="secondary" onClick={()=>void revoke()}>Выйти на всех устройствах</Button>
    </>
  );
}

export function SettingsPage() {
  const {session,refresh}=useSession();
  const [dialog,setDialog]=useState<'data'|'account'|'consent'|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [done,setDone]=useState<string|null>(null);
  if(!session?.authenticated)return null;
  const a=session.account;
  const act=async()=>{setBusy(true);setError(null);
    try{
      if(dialog==='data'){await api('deleteData',{confirmation:'DELETE_MY_LEARNING_DATA'},{key:newKey()});setDone('Учебные данные удалены. Аккаунт сохранён.');}
      if(dialog==='consent'){await api('revokeConsent',{},{key:newKey()});await refresh();setDone('Согласие отозвано: новые разборы недоступны.');}
      if(dialog==='account'){await api('deleteAccount',{confirmation:'DELETE_MY_ACCOUNT'},{key:newKey()});await refresh();navigate('/auth/login',{replace:true,force:true});}
      setDialog(null);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const accept=async()=>{setError(null);try{await api('acceptConsent',{policyVersion:POLICY,accepted:true},{key:newKey()});await refresh();}catch(e){setError(errorText(e));}};
  const text={data:'Удалятся все ситуации, разборы, упражнения, диалоги, практика, карточки, тесты и прогресс — на сайте и в боте. Аккаунт и почта останутся.',account:'Удалятся аккаунт, почта, входы на сайт, напоминания и все учебные данные. Начать заново можно в боте командой /start.',consent:'Новые разборы станут недоступны. Сохранённые данные останутся, пока вы их не удалите.'};
  return (
    <>
      <h1>Настройки</h1>
      {done&&<Notice tone="success">{done}</Notice>}{error&&<Notice tone="error">{error}</Notice>}
      <section className="card"><h2>Аккаунт</h2>
        <dl className="meta"><dt>Имя</dt><dd>{a.displayName}</dd><dt>Почта</dt><dd>{a.emailVerified?'подтверждена':'не подтверждена'}</dd><dt>Согласие</dt><dd>{a.consentVersion??'нет'}</dd></dl>
        <p className="small muted">Вход — через Telegram-бота. Пароля нет. Данные проходят через Telegram и сервер проекта; модель работает на компьютере команды.</p>
        {a.consentVersion!==POLICY?<Button onClick={()=>void accept()}>Дать согласие (web-telegram-2, черновик)</Button>:<Button variant="secondary" onClick={()=>setDialog('consent')}>Отозвать согласие</Button>}
      </section>
      <section className="card"><h2>Почта</h2><EmailSection/></section>
      <section className="card"><h2>Напоминания</h2><RemindersForm/></section>
      <section className="card"><h2>Входы на сайт</h2><WebSessions/></section>
      <section className="card"><h2>Удаление</h2>
        <p className="small muted">Сообщения в чате Telegram эти действия не удаляют — их можно удалить только в Telegram. Резервные копии очищаются по сроку хранения, не мгновенно.</p>
        <div className="actions"><Button variant="danger" onClick={()=>setDialog('data')}>Удалить учебные данные</Button><Button variant="danger" onClick={()=>setDialog('account')}>Удалить аккаунт</Button></div>
      </section>
      <Modal open={dialog!==null} title={dialog==='data'?'Удалить учебные данные?':dialog==='account'?'Удалить аккаунт?':'Отозвать согласие?'} onClose={()=>setDialog(null)} actions={<><Button variant="danger" busy={busy} onClick={()=>void act()}>Подтвердить</Button><Button variant="secondary" onClick={()=>setDialog(null)}>Отмена</Button></>}>
        <p>{dialog?text[dialog]:''}</p>
      </Modal>
    </>
  );
}
