import {InlineKeyboard,type Api} from 'grammy';
import {encode} from './callbacks.js';
import {chunk} from './text.js';

/** Button spec: versioned buttons go stale when the dialog step changes; free ones are re-checked by the domain. */
export interface Btn {label:string;op:string;arg?:string;free?:boolean}
export const b=(label:string,op:string,arg?:string):Btn=>({label,op,arg});
export const f=(label:string,op:string,arg?:string):Btn=>({label,op,arg,free:true});
export type Rows=Btn[][];

export function keyboard(rows:Rows,version:number):InlineKeyboard|undefined {
  if(!rows.length)return undefined;
  const kb=new InlineKeyboard();
  rows.forEach((row,i)=>{for(const btn of row)kb.text(btn.label,encode(btn.op,btn.free?null:version,btn.arg));if(i<rows.length-1)kb.row();});
  return kb;
}

/** Sends plain text in chunks below the Telegram limit; the keyboard goes on the last chunk. */
export async function send(api:Api,chatId:string,text:string,rows:Rows=[],version=0) {
  const parts=chunk(text),markup=keyboard(rows,version);
  for(const [i,part] of parts.entries())
    await api.sendMessage(chatId,part,i===parts.length-1&&markup?{reply_markup:markup,link_preview_options:{is_disabled:true}}:{link_preview_options:{is_disabled:true}});
}

export const menuRows=():Rows=>[
  [f('Понять сообщение','m','u'),f('Сказать прямо','m','d')],
  [f('Попробовать на примере','m','ex')],
  [f('История','m','h'),f('Прогресс','m','p')],
  [f('Аккаунт','m','a')]
];
export const toMenu=f('В меню','m','menu');
