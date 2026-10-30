import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Health } from '@between/contracts';
import './style.css';
function App() {
  const [status,setStatus] = useState('Проверяем соединение…');
  useEffect(()=>{const controller=new AbortController(); fetch('/api/health/live',{signal:controller.signal}).then(r=>r.json()).then(data=>{Health.parse(data);setStatus('Сервер доступен');}).catch(()=>{if(!controller.signal.aborted)setStatus('Сервер недоступен. Обновите страницу.');});return ()=>controller.abort();},[]);
  return <main><p>ТРЕНАЖЁР ОБЩЕНИЯ</p><h1>Между строк</h1><p>Замечать сигналы. Проверять гипотезы. Подбирать слова.</p><section><h2>Технический каркас v1</h2><p role="status">{status}</p><p>Учебные сценарии и регистрация ещё не подключены.</p></section></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
