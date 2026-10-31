// Minimal Bot API client. The request URL contains the token: errors never carry URL, cause or raw text.
export interface TgUser {id:number;is_bot:boolean;first_name:string;username?:string}
export interface TgChat {id:number;type:'private'|'group'|'supergroup'|'channel'}
export interface TgMessage {message_id:number;date:number;chat:TgChat;from?:TgUser;text?:string}
export interface TgCallback {id:string;from:TgUser;message?:TgMessage;inline_message_id?:string;data?:string}
export interface TgUpdate {update_id:number;message?:TgMessage;callback_query?:TgCallback;[other:string]:unknown}
export interface InlineButton {text:string;callback_data:string}
export interface SendOptions {reply_markup?:{inline_keyboard:InlineButton[][]}}

export class TelegramError extends Error {
  constructor(public status:number,public description:string,public retryAfter?:number) {super(`Telegram API ${status}`);}
}
/** Network failure or abort; deliberately without the original error (it may contain the URL). */
export class TelegramUnavailable extends Error {constructor() {super('Telegram API unavailable');}}

export const isUnreachable=(error:unknown)=>error instanceof TelegramError&&(error.status===403||(error.status===400&&/chat not found|user is deactivated/i.test(error.description)));
export const isRateLimited=(error:unknown)=>error instanceof TelegramError&&error.status===429;

export type Fetch=(url:string,init:{method:string;headers:Record<string,string>;body:string;signal?:AbortSignal})=>Promise<{json():Promise<unknown>}>;
const sleep=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
const MAX_WAIT_SECONDS=30,MAX_RETRIES=2;

export class TelegramApi {
  constructor(private token:string,private fetcher:Fetch=fetch as unknown as Fetch,private sleeper=sleep) {}
  async call<T>(method:string,params:Record<string,unknown>={},signal?:AbortSignal):Promise<T> {
    for(let attempt=0;;attempt++){
      let body:{ok?:boolean;result?:T;error_code?:number;description?:string;parameters?:{retry_after?:number}};
      try{
        const response=await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),...(signal?{signal}:{})});
        body=await response.json() as typeof body;
      }catch{throw new TelegramUnavailable();}
      if(body.ok)return body.result as T;
      const wait=body.error_code===429?body.parameters?.retry_after:undefined;
      if(wait!==undefined&&attempt<MAX_RETRIES&&wait<=MAX_WAIT_SECONDS&&!signal?.aborted){await this.sleeper(wait*1000,signal);continue;}
      throw new TelegramError(body.error_code??0,String(body.description??'').slice(0,200),wait);
    }
  }
  getMe() {return this.call<TgUser>('getMe');}
  getUpdates(offset:string,timeout:number,signal:AbortSignal) {
    // offset may exceed 2^53 only theoretically; Telegram accepts it as a JSON number string-encoded integer.
    return this.call<TgUpdate[]>('getUpdates',{offset:Number(offset),timeout,allowed_updates:['message','callback_query']},signal);
  }
  sendMessage(chatId:string,text:string,options:SendOptions={}) {
    return this.call<TgMessage>('sendMessage',{chat_id:chatId,text,link_preview_options:{is_disabled:true},...options});
  }
  answerCallbackQuery(id:string,text?:string) {return this.call<boolean>('answerCallbackQuery',{callback_query_id:id,...(text?{text}:{})});}
  setMyCommands(commands:{command:string;description:string}[]) {return this.call<boolean>('setMyCommands',{commands,scope:{type:'all_private_chats'}});}
}
