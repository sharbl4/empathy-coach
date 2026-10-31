import {GrammyError,type Transformer} from 'grammy';

const MAX_WAIT_SECONDS=30,MAX_RETRIES=2;
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Bounded retry on 429 retry_after; everything else (including 403 blocked) surfaces to the caller. */
export const retryAfter=(sleeper=sleep):Transformer=>async(prev,method,payload,signal)=>{
  for(let attempt=0;;attempt++){
    const result=await prev(method,payload,signal);
    const wait=!result.ok&&result.error_code===429?result.parameters?.retry_after:undefined;
    if(wait===undefined||attempt>=MAX_RETRIES||wait>MAX_WAIT_SECONDS)return result;
    await sleeper(wait*1000);
  }
};

/** 403 «bot was blocked» / «user is deactivated», 400 «chat not found»: do not retry delivery. */
export function isUnreachable(error:unknown) {
  if(!(error instanceof GrammyError))return false;
  return error.error_code===403||(error.error_code===400&&/chat not found/i.test(error.description));
}
export const isRateLimited=(error:unknown)=>error instanceof GrammyError&&error.error_code===429;
