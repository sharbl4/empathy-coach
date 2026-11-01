import {useCallback,useEffect,useRef,useState} from 'react';

/** Loads data with abort on unmount/deps change; reload() re-runs. */
export function useAsync<T>(load:(signal:AbortSignal)=>Promise<T>,deps:unknown[]) {
  const [state,setState]=useState<{data?:T;error?:unknown;loading:boolean}>({loading:true});
  const [tick,setTick]=useState(0);
  const ref=useRef(load);ref.current=load;
  useEffect(()=>{
    const controller=new AbortController();
    setState(s=>({...s,loading:true,error:undefined}));
    ref.current(controller.signal).then(data=>{if(!controller.signal.aborted)setState({data,loading:false});},error=>{if(!controller.signal.aborted)setState({error,loading:false});});
    return ()=>controller.abort();
  },[...deps,tick]);
  const reload=useCallback(()=>setTick(n=>n+1),[]);
  return {...state,reload};
}

/** Polls GET /api/runs/:id every 1.5 s while pending, at most 10 min; stops on unmount. */
export function usePoll<T>(load:(signal:AbortSignal)=>Promise<T>,done:(value:T)=>boolean,deps:unknown[]) {
  const [state,setState]=useState<{data?:T;error?:unknown;timedOut?:boolean}>({});
  const ref=useRef({load,done});ref.current={load,done};
  useEffect(()=>{
    const controller=new AbortController(),started=Date.now();let timer:number|undefined;
    const step=()=>{ref.current.load(controller.signal).then(data=>{
      if(controller.signal.aborted)return;
      setState({data});
      if(!ref.current.done(data)){if(Date.now()-started>600000){setState({data,timedOut:true});return;}timer=window.setTimeout(step,1500);}
    },error=>{if(!controller.signal.aborted)setState(s=>({...s,error}));});};
    step();
    return ()=>{controller.abort();window.clearTimeout(timer);};
  },deps);
  return state;
}
