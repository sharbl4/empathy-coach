import {encode} from './callbacks.js';
import type {InlineButton,TelegramApi} from './telegram.js';
import {chunk} from './text.js';

/** Button spec: versioned buttons go stale when the dialogue revision changes; free ones are re-checked by the domain. */
export interface Btn {label:string;op:string;arg?:string;free?:boolean}
export const b=(label:string,op:string,arg?:string):Btn=>({label,op,arg});
export const f=(label:string,op:string,arg?:string):Btn=>({label,op,arg,free:true});
export type Rows=Btn[][];

export const keyboard=(rows:Rows,version:number):InlineButton[][]=>rows.map(row=>row.map(btn=>({text:btn.label,callback_data:encode(btn.op,btn.free?null:version,btn.arg)})));

/** Plain text in chunks below the Telegram limit; the keyboard goes on the last chunk. */
export async function send(tg:TelegramApi,chatId:string,text:string,rows:Rows=[],version=0) {
  const parts=chunk(text),markup=rows.length?{reply_markup:{inline_keyboard:keyboard(rows,version)}}:{};
  for(const [i,part] of parts.entries())await tg.sendMessage(chatId,part,i===parts.length-1?markup:{});
}

export const menuRows=():Rows=>[
  [f('Понять сообщение','m','u'),f('Сказать прямо','m','d')],
  [f('История','m','h'),f('Прогресс','m','p')],
  [f('Аккаунт','m','a')]
];
export const toMenu=f('В меню','m','menu');
