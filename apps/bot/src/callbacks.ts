import {createHash} from 'node:crypto';

// callback_data: "<op>|<stateVersion or ->|<arg>". Never contains user text; IDs are re-checked by the domain.
export const CALLBACK_LIMIT=64;
const ID=/^[0-9a-f-]{36}$/i, SHORT=/^[a-z0-9_]{1,20}$/i;

export interface Callback {op:string;version:number|null;arg:string}

export function encode(op:string,version:number|null,arg=''):string {
  const data=`${op}|${version===null?'-':version.toString(36)}|${arg}`;
  if(Buffer.byteLength(data)>CALLBACK_LIMIT)throw new Error('callback_data too long');
  return data;
}
export function decode(data:string|undefined):Callback|null {
  if(!data||Buffer.byteLength(data)>CALLBACK_LIMIT)return null;
  const [op,v,arg,...rest]=data.split('|');
  if(rest.length||!op||!SHORT.test(op)||v===undefined||arg===undefined)return null;
  if(arg&&!ID.test(arg)&&!SHORT.test(arg))return null;
  const version=v==='-'?null:Number.parseInt(v,36);
  if(version!==null&&(!Number.isSafeInteger(version)||version<0))return null;
  return {op,version,arg};
}

/** Stable UUID-shaped idempotency key for one intent (same click on same step → same key). */
export function intentKey(...parts:(string|number)[]):string {
  const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h[16]!,16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
