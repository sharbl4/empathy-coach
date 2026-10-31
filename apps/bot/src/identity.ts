import {PrivateTelegramIdentity} from '@between/contracts/domain';
import type {TgChat,TgUpdate,TgUser} from './telegram.js';

const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
export type Classified=
  |{kind:'private';identity:PrivateTelegramIdentity;sender:TgUser}
  |{kind:'group_command';chatId:string}
  |{kind:'callback_rejected';callbackId:string}
  |{kind:'ignored'};

/**
 * Owner comes only from this getUpdates result: message.from or callback_query.from,
 * and the chat must be the matching private chat. Inline callbacks (no message) are rejected.
 */
export function classify(update:TgUpdate):Classified {
  if(!Number.isSafeInteger(update.update_id)||update.update_id<0)return {kind:'ignored'};
  const updateId=String(update.update_id);
  const priv=(from:TgUser|undefined,chat:TgChat|undefined):Classified|null=>{
    if(!from||from.is_bot||!chat||chat.type!=='private'||!safe(from.id)||!safe(chat.id)||from.id!==chat.id)return null;
    const parsed=PrivateTelegramIdentity.safeParse({telegramUserId:String(from.id),privateChatId:String(chat.id),updateId});
    return parsed.success?{kind:'private',identity:parsed.data,sender:from}:null;
  };
  if(update.message){
    const m=update.message,found=priv(m.from,m.chat);
    if(found)return found;
    if(m.chat&&m.chat.type!=='private'&&m.text?.startsWith('/')&&Number.isSafeInteger(m.chat.id))return {kind:'group_command',chatId:String(m.chat.id)};
    return {kind:'ignored'};
  }
  if(update.callback_query){
    const c=update.callback_query,found=c.message?priv(c.from,c.message.chat):null;
    return found??{kind:'callback_rejected',callbackId:c.id};
  }
  return {kind:'ignored'};
}
