import { supabaseVerifier } from './verifier.js';
import { HttpError } from '../errors.js';
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!url||!key){console.error('BLOCKED: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');process.exitCode=1;}
else {
  try {
    const endpoint=new URL('/auth/v1/settings',url);
    if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(endpoint.hostname))throw new Error();
    const response=await fetch(endpoint,{headers:{apikey:key},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw new Error();
    const settings=await response.json() as {external?:{email?:boolean}};
    console.info(`Auth settings reachable; email provider enabled: ${settings.external?.email===true}`);
    if(process.env.SUPABASE_TEST_ACCESS_TOKEN){await supabaseVerifier().verify(process.env.SUPABASE_TEST_ACCESS_TOKEN);console.info('Supabase getUser with supplied test access token: passed');}
    else console.info('BLOCKED: positive getUser needs SUPABASE_TEST_ACCESS_TOKEN from a signed-in test user; email/confirmation/recovery require separate checks');
  }catch(error){console.error(`BLOCKED: ${error instanceof HttpError?error.code:'AUTH_ACCESS_CHECK_FAILED'}`);process.exitCode=1;}
}
