import { createClient } from '@supabase/supabase-js';
import { Id } from '@between/contracts';
import { HttpError, unavailable } from '../errors.js';
export interface AuthVerifier { verify(token:string):Promise<string>; }
export function supabaseVerifier(): AuthVerifier {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return {verify:async()=>{throw unavailable();}};
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}});
  return {async verify(token) {
    try {
      const {data,error}=await client.auth.getUser(token);
      if (error) {
        if (error.status===400 || error.status===401 || error.status===403 || error.status===404 || error.status===422) throw new HttpError(401,'UNAUTHORIZED','Войдите в аккаунт');
        throw unavailable();
      }
      if (!data.user || !Id.safeParse(data.user.id).success) throw new HttpError(401,'UNAUTHORIZED','Войдите в аккаунт');
      return data.user.id;
    } catch(error) { if(error instanceof HttpError) throw error; throw unavailable(); }
  }};
}
