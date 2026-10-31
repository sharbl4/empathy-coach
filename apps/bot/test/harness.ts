import type {UserFromGetMe} from 'grammy/types';
import {createBot,DeliveryWorker} from '../src/bot.js';
import {MemoryDomain} from './memory-domain.js';

// Mock Telegram transport: grammY runs for real, outgoing Bot API calls are captured, nothing leaves the process.
export const botInfo={id:1,is_bot:true,first_name:'Test',username:'between_test_bot',can_join_groups:true,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false} as unknown as UserFromGetMe;
const TOKEN='123456:TEST_ONLY_TOKEN_aaaaaaaaaaaaaaaaaaaaaaaaa';

export interface Sent {method:string;chat_id?:string|number;text?:string;buttons:{text:string;data:string}[]}
let updateSeq=1000;

export class Harness {
  sent:Sent[]=[];
  failNext:((method:string)=>{error_code:number;description:string;parameters?:{retry_after:number}}|null)|null=null;
  bot;flows;worker;
  constructor(public domain=new MemoryDomain()) {
    const {bot,flows}=createBot(TOKEN,domain,{botInfo});
    bot.api.config.use(async(_prev,method,payload)=>{
      const fail=this.failNext?.(method);
      if(fail){this.failNext=null;return {ok:false,...fail} as never;}
      const p=payload as Record<string,unknown>&{reply_markup?:{inline_keyboard?:{text:string;callback_data:string}[][]}};
      this.sent.push({method,chat_id:p.chat_id as string,text:p.text as string|undefined,buttons:(p.reply_markup?.inline_keyboard??[]).flat().map(x=>({text:x.text,data:x.callback_data}))});
      return {ok:true,result:method==='sendMessage'?{message_id:this.sent.length,date:0,chat:{id:Number(p.chat_id),type:'private'},text:p.text}:true} as never;
    });
    this.bot=bot;this.flows=flows;this.worker=new DeliveryWorker(bot.api,domain,flows,1000);
  }
  private from(id:number) {return {id,is_bot:false,first_name:'Тест'};}
  async message(text:string,{user=42,chat,updateId}:{user?:number;chat?:{id:number;type:'private'|'group'|'supergroup';title?:string};updateId?:number}={}) {
    const c=chat??{id:user,type:'private' as const,first_name:'Тест'};
    const entities=text.startsWith('/')?[{type:'bot_command' as const,offset:0,length:text.split(/\s/)[0]!.length}]:undefined;
    await this.bot.handleUpdate({update_id:updateId??updateSeq++,message:{message_id:1,date:0,chat:c as never,from:this.from(user),text,...(entities?{entities}:{})}});
  }
  async callback(data:string,{user=42,updateId}:{user?:number;updateId?:number}={}) {
    await this.bot.handleUpdate({update_id:updateId??updateSeq++,callback_query:{id:String(updateSeq),from:this.from(user),chat_instance:'ci',data,message:{message_id:1,date:0,chat:{id:user,type:'private',first_name:'Тест'}} as never}});
  }
  messages() {return this.sent.filter(s=>s.method==='sendMessage');}
  last() {return this.messages().at(-1)!;}
  lastText() {return this.last().text??'';}
  /** Latest button with this label in any sent message (newest first). */
  button(label:string|RegExp) {
    for(const m of [...this.messages()].reverse()){const btn=m.buttons.find(x=>typeof label==='string'?x.text===label:label.test(x.text));if(btn)return btn.data;}
    throw new Error(`No button ${label}`);
  }
  async click(label:string|RegExp,user=42) {await this.callback(this.button(label),{user});}
  async deliver() {await this.worker.tick();}

  /** Fresh account → onboarding → verified email. */
  async register(user=42) {
    await this.message('/start',{user});await this.click('Понятно, продолжить',user);
    await this.message(`user${user}@example.com`,{user});await this.message(this.domain.lastCode,{user});
  }
}
