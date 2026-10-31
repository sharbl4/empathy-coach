import {hmac} from './core.js';
export type Mask={kind:'email'|'phone';hash:string};
/** Sanitization of user text only; metadata IDs are never an identity authority. */
export function maskText(value:string,onMask?:(kind:Mask['kind'],canonical:string)=>void){return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi,match=>{onMask?.('email',match.toLowerCase());return '[email скрыт]';}).replace(/(?<![\p{L}\p{N}])\+?\d[\d ()–.-]{5,}\d(?![\p{L}\p{N}])/gu,match=>{const digits=match.replace(/\D/g,'');if(digits.length<7||digits.length>15)return match;onMask?.('phone',digits);return '[телефон скрыт]';});}
export function maskAll<T>(value:T):T{if(typeof value==='string')return maskText(value) as T;if(Array.isArray(value))return value.map(maskAll) as T;if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='id'||k.endsWith('Id')?v:maskAll(v)])) as T;return value;}
/** Count represented masks, including copies sanitized when the session was saved. */
export const representedMasks=(value:string)=>[...value.matchAll(/\[(?:email|телефон) скрыт\]/gu)].length;
export function captureText(value:string,secret:string,owner:string,prior:Mask[]=[]){const masks:Mask[]=[],available=[...prior];for(const marker of value.matchAll(/\[(email|телефон) скрыт\]/gu)){const kind=marker[1]==='email'?'email':'phone',index=available.findIndex(m=>m.kind===kind);if(index>=0)masks.push(...available.splice(index,1));}const clean=maskText(value,(kind,canonical)=>masks.push({kind,hash:hmac(secret,'pii-count',owner,kind,canonical)}));return {value:clean,masks};}
export function captureAll<T>(value:T,secret:string,owner:string,prior:Record<string,Mask[]>={}){const redactions:Record<string,Mask[]>={};const visit=(v:unknown,path:string):unknown=>{
  if(typeof v==='string'){const r=captureText(v,secret,owner,prior[path]);if(r.masks.length)redactions[path]=r.masks;return r.value;}
  if(Array.isArray(v))return v.map((item,index)=>visit(item,path+'.'+index));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,k==='id'||k.endsWith('Id')?item:visit(item,path?path+'.'+k:k)]));return v;
};return {value:visit(value,'') as T,redactions};}
export const uniqueMasks=(fields:Record<string,Mask[]>)=>new Set(Object.values(fields).flat().map(m=>m.hash)).size;
