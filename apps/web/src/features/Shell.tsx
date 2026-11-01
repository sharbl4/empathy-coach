import {useState,type ReactNode} from 'react';
import {Link,navigate,useLocation} from '../app/router';
import {Button,Notice} from '../components/ui';
import {auth,errorText,newKey} from '../lib/api';
import {useSession} from '../lib/session';

const nav=[['/new','Новый разбор'],['/history','История'],['/practice','Практика'],['/progress','Прогресс'],['/settings','Настройки']] as const;

export function Shell({children}:{children:ReactNode}) {
  const {pathname}=useLocation();
  const {session,refresh}=useSession();
  const [error,setError]=useState<string|null>(null);
  const logout=async()=>{
    setError(null);
    try{await auth('logout',{},{key:newKey()});}catch(e){setError(errorText(e));}
    const after=await refresh();
    if(after&&!after.authenticated)navigate('/auth/login',{replace:true,force:true});
    else setError('Выйти не удалось: сессия ещё активна. Попробуйте ещё раз.');
  };
  return (
    <div className="shell">
      <a className="skip-link" href="#main">К содержимому</a>
      <header className="shell-header">
        <div className="shell-top">
          <Link to="/history" className="brand">Empather</Link>
          <div className="shell-user">
            {session?.authenticated&&<span className="user-name">{session.account.displayName}</span>}
            <Button variant="ghost" onClick={()=>void logout()}>Выйти</Button>
          </div>
        </div>
        <nav aria-label="Разделы"><ul className="nav">{nav.map(([to,label])=><li key={to}><Link to={to} aria-current={pathname===to||pathname.startsWith(`${to}/`)?'page':undefined}>{label}</Link></li>)}</ul></nav>
      </header>
      {error&&<Notice tone="error">{error}</Notice>}
      <main className="shell-main" id="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
