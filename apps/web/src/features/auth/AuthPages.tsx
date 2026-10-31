import {useRef,useState} from 'react';
import {navigate} from '../../app/router';
import {Button,Loading,Notice} from '../../components/ui';
import {auth,errorText,isApiError,newKey} from '../../lib/api';
import {takeConnectToken} from '../../lib/connectToken';
import {useSession} from '../../lib/session';
import {useAsync} from '../../lib/useAsync';

function Brand() {
  return <div className="auth-brand"><p className="eyebrow">Тренажёр переписки</p><h1>Между строк</h1><p className="tagline">Несколько возможных трактовок. Мысли не читаем.</p></div>;
}
function TelegramEntry({label='Открыть Telegram'}:{label?:string}) {
  const entry=useAsync(signal=>auth('entry',{},{signal}),[]);
  if(entry.loading)return <Loading label="Загружаем ссылку на бота"/>;
  if(entry.error||!entry.data)return <Notice tone="error">Не удалось получить ссылку на бота. Обновите страницу.</Notice>;
  return <a className="btn btn-primary" href={entry.data.telegramUrl} rel="noopener noreferrer">{label}</a>;
}

/** Ordinary entry: no passwords here. The bot issues a one-time link. */
export function LoginPage() {
  return (
    <main className="auth-page" id="main">
      <Brand/>
      <div className="auth-card">
        <h2>Вход</h2>
        <p>Сайт открывает тот же аккаунт, что и Telegram-бот. Пароля нет.</p>
        <ol><li>Откройте бота и подтвердите почту, если ещё не сделали этого.</li><li>Нажмите в боте «Открыть веб» — придёт одноразовая ссылка на 5 минут.</li><li>Перейдите по ней и нажмите «Подтвердить вход».</li></ol>
        <TelegramEntry/>
      </div>
    </main>
  );
}

/** Landing for the bot link. The token was taken from the fragment before React started; GET never redeems it. */
export function ConnectPage() {
  const token=useRef<string|null>(takeConnectToken());
  const key=useRef(newKey());
  const {refresh}=useSession();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const confirm=async()=>{
    if(!token.current)return;
    setBusy(true);setError(null);
    try{
      const current=await refresh(); // binding cookie + CSRF for this browser
      if(!current)throw new Error('session');
      await auth('redeemWebLink',{token:token.current,confirmed:true},{key:key.current});
      token.current=null;
      await refresh();
      navigate('/history',{replace:true,force:true});
    }catch(e){
      // Unknown outcome: check the session first instead of silently creating another one.
      const after=await refresh();
      if(after?.authenticated){token.current=null;navigate('/history',{replace:true,force:true});return;}
      setError(e);setBusy(false);
    }
  };
  const used=isApiError(error,'LINK_EXPIRED')||isApiError(error,'LINK_ALREADY_USED');
  return (
    <main className="auth-page" id="main">
      <Brand/>
      <div className="auth-card">
        <h2>Вход по ссылке из бота</h2>
        {!token.current&&!error?(
          <><Notice tone="error">Ссылка неполная или уже открыта в этой вкладке. Получите новую в боте («Открыть веб»).</Notice><TelegramEntry label="Получить ссылку в Telegram"/></>
        ):(
          <>
            <p>Подтвердите вход, только если ссылку только что запросили вы сами. Ссылка даёт доступ к аккаунту — не пересылайте её.</p>
            {error!==null&&<Notice tone="error">{errorText(error)}</Notice>}
            {used?<TelegramEntry label="Получить новую ссылку"/>:<Button busy={busy} onClick={()=>void confirm()}>Подтвердить вход</Button>}
          </>
        )}
      </div>
    </main>
  );
}
