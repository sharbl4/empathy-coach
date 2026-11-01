import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import type {z} from 'zod';
import type {PublicWebSession} from '@between/contracts/product';
import {auth,setCsrf,setUnauthorizedHandler} from './api';

type Session=z.infer<typeof PublicWebSession>;
interface SessionState {session:Session|null;error:boolean;refresh():Promise<Session|null>;}
const Ctx=createContext<SessionState|null>(null);

/** Server cookie session only: the browser never stores a token. CSRF token lives in memory. */
export function SessionProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null);
  const [error,setError]=useState(false);
  const refresh=useCallback(async()=>{
    try{const next=await auth('session',{});setCsrf(next.csrfToken);setSession(next);setError(false);return next;}
    catch{setError(true);return null;}
  },[]);
  useEffect(()=>{setUnauthorizedHandler(()=>{void refresh();});void refresh();},[refresh]);
  const value=useMemo(()=>({session,error,refresh}),[session,error,refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSession() {const v=useContext(Ctx);if(!v)throw new Error('SessionProvider missing');return v;}
