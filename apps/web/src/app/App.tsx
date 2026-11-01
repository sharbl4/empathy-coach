import {useEffect,type ReactNode} from 'react';
import {matchPath,navigate,useLocation} from './router';
import {Loading,Notice,Button} from '../components/ui';
import {useSession} from '../lib/session';
import {ConnectPage,LoginPage} from '../features/auth/AuthPages';
import {Shell} from '../features/Shell';
import {HistoryPage} from '../features/history/HistoryPage';
import {ComposePage,ExamplesPage} from '../features/compose/ComposePage';
import {PreviewPage} from '../features/preview/PreviewPage';
import {RunPage} from '../features/runs/RunPage';
import {RoleplayPage,SessionPage} from '../features/sessions/SessionPage';
import {PracticePage} from '../features/practice/PracticePage';
import {ProgressPage} from '../features/progress/ProgressPage';
import {SettingsPage} from '../features/settings/SettingsPage';

function Redirect({to}:{to:string}) {useEffect(()=>{navigate(to,{replace:true,force:true});},[to]);return null;}

const routes:{pattern:string;render(p:Record<string,string>):ReactNode}[]=[
  {pattern:'/history',render:()=><HistoryPage/>},
  {pattern:'/new',render:()=><ComposePage/>},
  {pattern:'/examples',render:()=><ExamplesPage/>},
  // key remounts per id so no state or polling leaks between records.
  {pattern:'/previews/:id',render:p=><PreviewPage key={p.id} id={p.id!}/>},
  {pattern:'/runs/:id',render:p=><RunPage key={p.id} id={p.id!}/>},
  {pattern:'/sessions/:id',render:p=><SessionPage key={p.id} id={p.id!}/>},
  {pattern:'/roleplays/:id',render:p=><RoleplayPage key={p.id} id={p.id!}/>},
  {pattern:'/practice',render:()=><PracticePage/>},
  {pattern:'/progress',render:()=><ProgressPage/>},
  {pattern:'/settings',render:()=><SettingsPage/>},
];

export function App() {
  const {pathname}=useLocation();
  const {session,error,refresh}=useSession();
  if(pathname==='/auth/connect')return <ConnectPage/>;
  if(!session){
    if(error)return <main className="page-narrow" id="main"><Notice tone="error" action={<Button variant="secondary" onClick={()=>void refresh()}>Повторить</Button>}>Сервер недоступен. Проверьте связь и повторите.</Notice></main>;
    return <main className="page-narrow" id="main"><Loading label="Проверяем вход"/></main>;
  }
  if(pathname==='/auth/login')return session.authenticated?<Redirect to="/history"/>:<LoginPage/>;
  if(pathname==='/')return <Redirect to={session.authenticated?'/history':'/auth/login'}/>;
  for(const route of routes){
    const params=matchPath(route.pattern,pathname);
    if(!params)continue;
    if(!session.authenticated)return <Redirect to="/auth/login"/>;
    return <Shell key={session.account.id}>{route.render(params)}</Shell>;
  }
  return <main className="page-narrow" id="main"><h1>Страница не найдена</h1><p><a href="/">На главную</a></p></main>;
}
