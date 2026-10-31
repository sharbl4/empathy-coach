import type {PoolClient} from 'pg';
import {SessionInput} from '@between/contracts/domain';
import type {DomainTask} from '../ai/tasks.js';
import {digest,fail} from './core.js';
export function maskText(value:string){
  return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi,'[email скрыт]')
    .replace(/(?<![\p{L}\p{N}])\+?\d[\d ()–.-]{5,}\d(?![\p{L}\p{N}])/gu,match=>{
      const digits=match.replace(/\D/g,'');return digits.length>=7&&digits.length<=15?'[телефон скрыт]':match;
    });
}
export function maskAll<T>(value:T):T {
  if(typeof value==='string')return maskText(value) as T;
  if(Array.isArray(value))return value.map(maskAll) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,maskAll(item)])) as T;
  return value;
}
export function cleanSession(value:unknown){return SessionInput.parse(maskAll(SessionInput.parse(value)));}
export async function requireConfirmed(client:PoolClient,userId:string,sessionId:string,revision:number,task:DomainTask,secret:string,now:number){
  const hash=digest(secret,'confirmed-task',task);
  const row=(await client.query('SELECT context_hmac FROM app.ai_confirmations WHERE user_id=$1 AND session_id=$2 AND revision=$3 AND kind=$4 AND expires_at>$5',[userId,sessionId,revision,task.kind,new Date(now)])).rows[0];
  if(!row||row.context_hmac!==hash)fail('OPERATION_IN_PROGRESS');
}
