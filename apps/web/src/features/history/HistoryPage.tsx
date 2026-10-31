import {useState} from 'react';
import type {z} from 'zod';
import type {ContextType,LearningMode,SessionV2} from '@between/contracts/product';
import {Link} from '../../app/router';
import {Button,Loading,Notice} from '../../components/ui';
import {api,errorText} from '../../lib/api';
import {contextLabels,formatDate,modeLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';

type Session=z.infer<typeof SessionV2>;
type Ctx=z.infer<typeof ContextType>;type Mode=z.infer<typeof LearningMode>;

/** Shared history: the same records the bot shows. Search by title, filters, cursor pages. */
export function HistoryPage() {
  const [q,setQ]=useState('');const [query,setQuery]=useState('');
  const [contextType,setContext]=useState<Ctx|''>('');const [mode,setMode]=useState<Mode|''>('');
  const [extra,setExtra]=useState<{items:Session[];cursor:string|null}>({items:[],cursor:null});
  const [moreError,setMoreError]=useState<string|null>(null);const [loadingMore,setLoadingMore]=useState(false);
  const page=useAsync(async signal=>{const r=await api('sessions',{limit:20,...(query?{q:query}:{}),...(contextType?{contextType}:{}),...(mode?{mode}:{})},{signal});setExtra({items:[],cursor:r.nextCursor});return r;},[query,contextType,mode]);
  const more=async()=>{
    if(!extra.cursor)return;setLoadingMore(true);setMoreError(null);
    try{const r=await api('sessions',{limit:20,cursor:extra.cursor,...(query?{q:query}:{}),...(contextType?{contextType}:{}),...(mode?{mode}:{})});setExtra(s=>({items:[...s.items,...r.items],cursor:r.nextCursor}));}
    catch(e){setMoreError(errorText(e));}finally{setLoadingMore(false);}
  };
  const items=[...(page.data?.items??[]),...extra.items];
  return (
    <>
      <div className="page-head"><h1>История</h1><Link className="btn btn-primary" to="/new">Новый разбор</Link></div>
      <p className="small muted">Общая для сайта и Telegram-бота.</p>
      <form className="row" role="search" onSubmit={e=>{e.preventDefault();setQuery(q.trim());}}>
        <div className="field search"><label htmlFor="history-q">Поиск по названию</label><input id="history-q" type="search" value={q} maxLength={200} onChange={e=>setQ(e.target.value)}/></div>
        <div className="field"><label htmlFor="history-context">Сфера</label><select id="history-context" value={contextType} onChange={e=>setContext(e.target.value as Ctx|'')}><option value="">Все</option>{Object.entries(contextLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="history-mode">Режим</label><select id="history-mode" value={mode} onChange={e=>setMode(e.target.value as Mode|'')}><option value="">Все</option>{Object.entries(modeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <Button type="submit" variant="secondary">Найти</Button>
      </form>
      {page.loading&&<Loading label="Загружаем историю"/>}
      {page.error!==undefined&&<Notice tone="error" action={<Button variant="secondary" onClick={page.reload}>Повторить</Button>}>{errorText(page.error)}</Notice>}
      {!page.loading&&!page.error&&!items.length&&<div className="empty card"><p>{query||contextType||mode?'Ничего не найдено.':'Пока нет сохранённых разборов.'}</p><Link className="btn btn-primary" to="/new">Начать</Link></div>}
      <ul className="history-list">{items.map(s=><li key={s.id} className="history-item"><div><Link to={`/sessions/${s.id}`} className="history-title">{s.input.title}</Link><p className="small muted">{modeLabels[s.input.mode]} · {contextLabels[s.input.contextType]} · {formatDate(s.updatedAt)}</p></div></li>)}</ul>
      {moreError&&<Notice tone="error">{moreError}</Notice>}
      {extra.cursor&&<div className="actions"><Button variant="secondary" busy={loadingMore} onClick={()=>void more()}>Показать ещё</Button></div>}
    </>
  );
}
