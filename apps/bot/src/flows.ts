import type {z} from 'zod';
import {DomainErrorCode,type Account,type Dialogue,type DialogueDraft,type DialogueStage,type DomainDelivery,type DomainFacade,type DomainRun,type Goal,type UserContext} from '@between/contracts/domain';
import {type Callback,intentKey} from './callbacks.js';
import type {TelegramApi} from './telegram.js';
import * as T from './text.js';
import {type Rows,b,f,menuRows,send,toMenu} from './ui.js';

type Draft=z.infer<typeof DialogueDraft>;
type Stage=z.infer<typeof DialogueStage>;
type Dlg=z.infer<typeof Dialogue>;
type AccountValue=z.infer<typeof Account>;
type GoalValue=z.infer<typeof Goal>;
type Code=z.infer<typeof DomainErrorCode>;

export interface Turn {
  tg:TelegramApi;ctx:UserContext;chat:string;account:AccountValue;dlg:Dlg;
  /** Stable per Telegram update (UpdateReceipt.intentKey) or delivery id; sub-keys derive from it. */
  intent:string;seq:number;
}

/** Domain failures carry a safe code; anything else is treated as transient by the poller. */
export function failureCode(error:unknown):Code|null {
  const code=error&&typeof error==='object'&&'code' in error?(error as {code:unknown}).code:undefined;
  const parsed=DomainErrorCode.safeParse(code);
  return parsed.success?parsed.data:null;
}
const TRANSIENT=new Set<Code>(['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export const isTransient=(error:unknown)=>{const code=failureCode(error);return code===null||TRANSIENT.has(code);};

const GOALS:GoalValue[]=['support','clarify','reconcile','boundary'];
const HISTORY_PAGE=5;
const EMAIL=/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const POLICY='telegram-1';
const ready=(a:AccountValue)=>a.consentVersion===POLICY&&a.emailVerified&&a.onboardingCompletedAt!==null;
const isDirect=(d:Draft)=>d.feeling!==undefined;
/** Ops allowed before consent/email verification. */
const OPEN_OPS=new Set(['ok','rs','ce','ac','ay','help','nav']);

export class Flows {
  // Email challenge IDs are not part of DialogueDraft (contract gap): kept only in memory; after restart the user resends.
  private challenges=new Map<string,string>();
  // History cursors are navigation only; after restart «Дальше» starts from page 1.
  private cursors=new Map<string,(string|null)[]>();
  constructor(private domain:DomainFacade) {}

  // ---------- helpers
  key(t:Turn,label:string) {return intentKey(t.intent,label,t.seq++);}
  private say(t:Turn,text:string,rows:Rows=[]) {return send(t.tg,t.chat,text,rows,t.dlg.revision);}
  private async go(t:Turn,stage:Stage,draft:Draft={},refs:{sessionId?:string|null;roleplayId?:string|null}={}) {
    t.dlg=await this.domain.updateDialogue(t.ctx,{expectedRevision:t.dlg.revision,stage,draft,sessionId:refs.sessionId===undefined?t.dlg.sessionId:refs.sessionId,roleplayId:refs.roleplayId===undefined?t.dlg.roleplayId:refs.roleplayId},this.key(t,'dialogue'));
    return t.dlg;
  }
  private async reset(t:Turn) {t.dlg=await this.domain.resetDialogue(t.ctx,t.dlg.revision,this.key(t,'reset'));return t.dlg;}
  async menu(t:Turn,prefix?:string) {
    await this.go(t,'menu',{},{sessionId:null,roleplayId:null});
    await this.say(t,prefix?`${prefix}\n\n${T.texts.menu}`:T.texts.menu,menuRows());
  }

  /** Definite domain outcome → user-facing text. Transient failures are rethrown for the poller to retry. */
  async explain(t:Turn,error:unknown) {
    if(isTransient(error))throw error;
    switch(failureCode(error)){
      case 'REVISION_CONFLICT':{t.dlg=await this.domain.dialogue(t.ctx);return this.say(t,T.texts.conflict,menuRows());}
      case 'IDEMPOTENCY_CONFLICT':{t.dlg=await this.domain.dialogue(t.ctx);return this.say(t,T.texts.stale,menuRows());}
      case 'NOT_FOUND':return this.say(t,T.texts.notFound,[[toMenu]]);
      case 'OPERATION_IN_PROGRESS':return this.say(t,T.texts.busy);
      case 'RATE_LIMITED':return this.say(t,T.texts.rateLimited,[[toMenu]]);
      case 'EMAIL_NOT_VERIFIED':return this.say(t,T.texts.needVerify);
      case 'CONSENT_REQUIRED':return this.say(t,T.texts.needConsent,[[f('Аккаунт','m','a')]]);
      case 'CODE_INVALID':return this.say(t,'Код не подошёл. Проверь цифры из последнего письма.',[[f('Отправить код ещё раз','rs')]]);
      case 'CODE_EXPIRED':return this.say(t,'Срок кода истёк или попытки закончились. Запроси новый.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
      case 'UNAUTHORIZED':return this.say(t,'Нужно заново начать: отправь /start.');
      default:return this.say(t,'Проверь введённые данные и попробуй ещё раз. Черновик сохранён.');
    }
  }
  private async guard(t:Turn,work:()=>Promise<unknown>) {try{await work();}catch(error){await this.explain(t,error);}}

  // ---------- entry points
  async command(t:Turn,cmd:string) {
    return this.guard(t,async()=>{
      if(cmd==='start')return this.start(t);
      if(cmd==='help')return this.say(t,T.texts.help,ready(t.account)?[[toMenu]]:[]);
      if(cmd==='account')return this.accountView(t);
      if(cmd==='cancel'){
        const waiting=t.dlg.stage==='waiting_run';
        if(!ready(t.account))return this.resumeOnboarding(t);
        return this.menu(t,waiting?'Уже запущенный запрос не отменяется — результат придёт сюда.':T.texts.cancelled);
      }
      if(!ready(t.account))return this.resumeOnboarding(t);
      if(cmd==='menu')return this.menu(t);
      if(cmd==='history')return this.history(t,0);
      return this.say(t,`Не знаю такой команды.\n\n${T.texts.help}`);
    });
  }

  async text(t:Turn,raw:string) {
    return this.guard(t,async()=>{
      const text=raw.trim(),stage=t.dlg.stage;
      if(stage==='email')return this.emailInput(t,text);
      if(stage==='email_code')return this.codeInput(t,text);
      if(!ready(t.account))return this.resumeOnboarding(t);
      switch(stage){
        case 'message':case 'relationship':case 'context':return this.situationInput(t,stage,text);
        case 'guess':return this.guessInput(t,text);
        case 'direct_feeling':case 'direct_need':case 'direct_request':return this.directInput(t,stage,text);
        case 'draft':case 'exercise_answer':case 'roleplay':return this.ownText(t,text);
        case 'waiting_run':return this.say(t,`${T.texts.busy} /menu — главное меню.`);
        case 'menu':{
          if(text.length>T.limits.message)return this.say(t,T.tooLong(T.limits.message,text.length));
          await this.go(t,'menu',{message:text},{sessionId:null,roleplayId:null});
          return this.say(t,'Что сделать с этим текстом?',[[b('Понять сообщение','pick','u'),b('Сказать прямо о себе','pick','d')],[toMenu]]);
        }
        default:return this.say(t,T.texts.unknownInput);
      }
    });
  }

  async callback(t:Turn,cb:Callback|null) {
    return this.guard(t,async()=>{
      if(!cb||(cb.version!==null&&cb.version!==t.dlg.revision))return this.say(t,T.texts.stale,ready(t.account)?menuRows():[]);
      if(!ready(t.account)&&!OPEN_OPS.has(cb.op))return this.resumeOnboarding(t);
      const handler=this.ops[cb.op];
      if(!handler)return this.say(t,T.texts.stale,menuRows());
      return handler(t,cb.arg);
    });
  }

  private ops:Record<string,(t:Turn,arg:string)=>Promise<unknown>>={
    // onboarding / account
    ok:t=>this.acceptConsent(t),
    rs:t=>this.resend(t),
    ce:t=>this.go(t,'email').then(()=>this.say(t,T.texts.askEmail)),
    ac:(t,arg)=>this.accountAction(t,arg),
    ay:(t,arg)=>this.accountConfirm(t,arg),
    help:t=>this.say(t,T.texts.help),
    nav:(t,arg)=>this.nav(t,arg),
    // menu
    m:(t,arg)=>this.menuAction(t,arg),
    pick:(t,arg)=>{const message=t.dlg.draft.message;
      return arg==='d'?this.step(t,'direct_feeling',message?{message}:{}):this.step(t,'relationship',message?{message}:{});},
    // situation steps
    g:(t,arg)=>GOALS.includes(arg as GoalValue)?this.afterGoal(t,arg as GoalValue):this.say(t,T.texts.stale),
    ns:t=>this.showConfirm(t,{...t.dlg.draft,emotions:[],evidenceQuotes:[],unsure:true}),
    qd:t=>this.showConfirm(t,t.dlg.draft),
    da:t=>this.showConfirm(t,(({draft:_d,...rest})=>{void _d;return rest;})(t.dlg.draft)),
    send:t=>this.confirm(t),
    edit:t=>this.edit(t),
    // results
    rw:(t,sid)=>this.withSession(t,sid,()=>this.go(t,'draft',{},{sessionId:sid,roleplayId:null}).then(()=>this.say(t,`Напиши свой черновик ответа (до ${T.limits.text} символов). Сначала свой вариант — так полезнее.\n\nЕсли не знаешь, с чего начать, нажми «Нужен пример».`,[[b('Нужен пример','rx',sid)],[toMenu]]))),
    rx:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,null,()=>this.domain.replyExamples(t.ctx,sid,{expectedRevision:s.revision},this.key(t,'reply_examples')))),
    xs:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,null,()=>this.domain.exercise(t.ctx,sid,{expectedRevision:s.revision},this.key(t,'exercise')))),
    xa:(t,runId)=>this.withRun(t,runId,run=>run.kind!=='exercise'||run.status!=='succeeded'?this.say(t,T.texts.stale,menuRows()):
      this.go(t,'exercise_answer',{},{sessionId:run.sessionId,roleplayId:null}).then(()=>this.say(t,`Напиши свою попытку одним сообщением (до ${T.limits.text} символов).`))),
    rp:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,'new',()=>this.domain.roleplayStart(t.ctx,sid,{expectedRevision:s.revision},this.key(t,'roleplay_start')))),
    fin:t=>{const sid=t.dlg.sessionId,rid=t.dlg.roleplayId;if(t.dlg.stage!=='roleplay'||!sid||!rid)return this.say(t,T.texts.stale,menuRows());
      return this.withSession(t,sid,s=>this.submit(t,sid,rid,()=>this.domain.roleplayFinish(t.ctx,rid,{expectedRevision:s.revision},this.key(t,'roleplay_finish'))));},
    rc:(t,sid)=>this.continueRoleplay(t,sid),
    cl:(t,runId)=>this.withRun(t,runId,run=>run.kind==='analysis'&&run.status==='succeeded'?this.say(t,T.clarify(run.output),[[toMenu]]):this.say(t,T.texts.notFound)),
    rt:(t,runId)=>this.withRun(t,runId,run=>run.status!=='failed'?this.say(t,T.texts.stale,menuRows()):
      this.submit(t,run.sessionId,run.kind.startsWith('roleplay')?t.dlg.roleplayId:null,()=>this.domain.retry(t.ctx,runId,{expectedRevision:run.revision},this.key(t,'retry')))),
    // history
    hn:(t,arg)=>this.history(t,Number(arg)||0),
    ho:(t,sid)=>this.openSession(t,sid),
    ha:(t,sid)=>this.showAnalysis(t,sid),
    hr:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,null,()=>this.domain.analyze(t.ctx,sid,{expectedRevision:s.revision},this.key(t,'analyze')))),
    hd:(t,sid)=>this.withSession(t,sid,s=>this.reset(t).then(()=>this.say(t,`Удалить «${T.shortTitle(s.title)}»?\n\nИз приложения удалятся ситуация, разборы и практика по ней. Сообщения в этом чате Telegram останутся — их можно удалить только в самом Telegram.`,[[b('Да, удалить','hy',sid),f('Нет','ho',sid)]]))),
    hy:async(t,sid)=>{await this.domain.deleteSession(t.ctx,sid,this.key(t,'delete_session'));await this.say(t,'Удалено из приложения.');return this.history(t,0);}
  };

  // ---------- onboarding: resolveUser → account → acceptConsent → requestEmailCode → verifyEmailCode → onboarding
  private async start(t:Turn) {
    if(ready(t.account))return this.menu(t,'С возвращением!');
    await this.say(t,T.texts.greeting);
    return this.resumeOnboarding(t);
  }
  async resumeOnboarding(t:Turn) {
    const a=t.account;
    if(a.consentVersion!==POLICY){if(t.dlg.stage!=='onboarding')await this.go(t,'onboarding');return this.say(t,T.texts.onboarding,[[b('Принимаю, продолжить','ok')],[f('Справка','help')]]);}
    if(!a.emailVerified){
      if(t.dlg.stage==='email_code')return this.say(t,'Введи 6 цифр из письма. Код действует 10 минут.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')],[f('Удалить аккаунт','ac','del')]]);
      if(t.dlg.stage!=='email')await this.go(t,'email');
      return this.say(t,T.texts.askEmail,[[f('Удалить аккаунт','ac','del')]]);
    }
    t.account=await this.domain.updateAccount(t.ctx,{onboardingCompleted:true},this.key(t,'onboarding'));
    return this.menu(t,'Готово, аккаунт подтверждён.');
  }
  private async acceptConsent(t:Turn) {
    t.account=await this.domain.acceptConsent(t.ctx,{policyVersion:POLICY,accepted:true},this.key(t,'consent'));
    return this.resumeOnboarding(t);
  }
  private async emailInput(t:Turn,email:string) {
    if(email.length>254||!EMAIL.test(email))return this.say(t,'Это не похоже на адрес почты. Пример: name@example.com');
    const challenge=await this.domain.requestEmailCode(t.ctx,{email},this.key(t,'email_code'));
    this.challenges.set(t.ctx.accountId,challenge.challengeId);
    await this.go(t,'email_code');
    return this.say(t,`Отправил код на ${T.maskEmail(email)}. Введи 6 цифр сюда. Код действует 10 минут.`,[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
  }
  private async resend(t:Turn) {
    // No resend method in the contract: re-request needs the address again (it is not stored in the dialogue).
    await this.go(t,'email');
    return this.say(t,'Напиши адрес ещё раз — отправлю новый код. Старый перестанет действовать. Повторно отправить можно не чаще раза в минуту.');
  }
  private async codeInput(t:Turn,code:string) {
    if(!/^\d{6}$/.test(code))return this.say(t,'Код — это 6 цифр из письма. Введи их одним сообщением.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
    const challengeId=this.challenges.get(t.ctx.accountId);
    if(!challengeId)return this.say(t,'Бот перезапускался, и этот код нужно запросить заново.',[[f('Отправить код ещё раз','rs')]]);
    t.account=await this.domain.verifyEmailCode(t.ctx,{challengeId,code},this.key(t,'verify'));
    this.challenges.delete(t.ctx.accountId);
    if(!t.account.emailVerified)return this.say(t,'Код не подошёл.',[[f('Отправить код ещё раз','rs')]]);
    await this.say(t,'Почта подтверждена.');
    return this.resumeOnboarding(t);
  }

  // ---------- account
  async accountView(t:Turn) {
    const a=t.account=await this.domain.account(t.ctx);
    const lines=[`Почта: ${a.emailVerified?'подтверждена':'не подтверждена'}`,`Согласие на обработку: ${a.consentVersion?`дано (${a.consentVersion})`:'нет'}`,'Вход — по твоему Telegram-аккаунту, пароль не нужен.'];
    const rows:Rows=a.emailVerified?[[f('Сменить почту','ac','email')],[f('Удалить учебные данные','ac','data')],[f('Отозвать согласие','ac','consent')],[f('Удалить аккаунт','ac','del')],[toMenu]]:[[f('Удалить аккаунт','ac','del')]];
    return this.say(t,`Аккаунт\n\n${lines.join('\n')}`,rows);
  }
  private async accountAction(t:Turn,arg:string) {
    if(arg==='email'){await this.go(t,'email');return this.say(t,'Напиши новый адрес. История останется в этом Telegram-аккаунте; новый адрес нужно подтвердить кодом.',[[b('Отмена','nav','cancel')]]);}
    const confirm:Record<string,[string,string]>={
      data:['Удалить учебные данные?\n\nУдалятся все ситуации, разборы, ответы, упражнения, диалоги и прогресс в приложении. Аккаунт и почта останутся.','Да, удалить учебные данные'],
      del:['Удалить аккаунт?\n\nУдалятся аккаунт, почта, коды подтверждения и все учебные данные приложения. Начать заново можно командой /start.','Да, удалить аккаунт'],
      consent:['Отозвать согласие?\n\nНовые разборы станут недоступны. Сохранённые данные останутся, пока ты их не удалишь.','Да, отозвать']
    };
    const c=confirm[arg];if(!c)return this.say(t,T.texts.stale);
    await this.reset(t);
    return this.say(t,`${c[0]}\n\nСообщения в этом чате Telegram это не удалит — их можно удалить только в самом Telegram. Резервные копии сервера очищаются по их сроку хранения, не мгновенно.`,[[b(c[1],'ay',arg)],[b('Отмена','nav','cancel')]]);
  }
  private async accountConfirm(t:Turn,arg:string) {
    if(arg==='data'){await this.domain.deleteData(t.ctx,{confirmation:'DELETE_MY_LEARNING_DATA'},this.key(t,'delete_data'));return this.menu(t,'Учебные данные удалены. Аккаунт сохранён.');}
    if(arg==='consent'){await this.domain.revokeConsent(t.ctx,this.key(t,'revoke'));t.account=await this.domain.account(t.ctx);return this.resumeOnboarding(t);}
    if(arg==='del'){await this.domain.deleteAccount(t.ctx,{confirmation:'DELETE_MY_ACCOUNT'},this.key(t,'delete_account'));return send(t.tg,t.chat,'Аккаунт и данные приложения удалены. Чтобы начать заново, отправь /start.');}
    return this.say(t,T.texts.stale);
  }

  // ---------- menu
  private async menuAction(t:Turn,arg:string) {
    switch(arg){
      case 'u':return this.step(t,'message',{});
      case 'd':return this.step(t,'direct_feeling',{});
      case 'h':return this.history(t,0);
      case 'p':return this.say(t,T.progress(await this.domain.progress(t.ctx)),[[f('История','m','h'),toMenu]]);
      case 'a':return this.accountView(t);
      default:return this.menu(t);
    }
  }
  private async nav(t:Turn,arg:string) {
    if(arg==='cancel'){if(!ready(t.account))return this.resumeOnboarding(t);return this.menu(t,T.texts.cancelled);}
    if(arg==='skip'&&t.dlg.stage==='context')return this.step(t,'goal',{...t.dlg.draft,context:''});
    if(arg==='back'){
      const order:Stage[]=isDirect(t.dlg.draft)?['direct_feeling','direct_need','direct_request','message','relationship','context','goal']:['message','relationship','context','goal','guess'];
      const i=order.indexOf(t.dlg.stage);
      if(i>0)return this.step(t,order[i-1]!,t.dlg.draft);
      return this.menu(t);
    }
    return this.say(t,T.texts.stale);
  }

  // ---------- steps (understand and say-direct share situation steps; mode = draft.feeling present)
  private async step(t:Turn,stage:Stage,draft:Draft) {
    await this.go(t,stage,draft,{sessionId:null,roleplayId:null});
    const back=[b('Назад','nav','back'),b('Отмена','nav','cancel')],cancel=[b('Отмена','nav','cancel')];
    const direct=isDirect(draft);
    switch(stage){
      case 'message':return this.say(t,direct?`Коротко опиши ситуацию, о которой хочешь сказать (до ${T.limits.message} символов).\n\n${T.texts.privacyHint}`:`Пришли сообщение, которое хочешь понять (до ${T.limits.message} символов). Только текст, который ты сам выбрал.\n\n${T.texts.privacyHint}`,[direct?back:cancel]);
      case 'relationship':return this.say(t,`${direct?'Кому ты хочешь это сказать?':'Кто тебе этот человек?'} Например: друг, мама, коллега (до ${T.limits.relationship} символов).`,[back]);
      case 'context':return this.say(t,`Что было до этого? Необязательно, до ${T.limits.context} символов.`,[[b('Пропустить','nav','skip')],back]);
      case 'goal':return this.say(t,direct?'Какая цель у разговора?':'Чего хочешь добиться ответом?',[GOALS.slice(0,2).map(g=>b(T.goalLabels[g],'g',g)),GOALS.slice(2).map(g=>b(T.goalLabels[g],'g',g)),back]);
      case 'guess':return this.say(t,`Сначала твоя версия: что, по-твоему, чувствует собеседник?\n\nНапиши до ${T.limits.emotions} эмоций через запятую — или нажми «Не понимаю». Это нормально.`,[[b('Не понимаю','ns')],back]);
      case 'direct_feeling':return this.say(t,`«Сказать прямо» помогает выразить свои чувства и потребности, а не угадывать чужие.\n\nЧто ты чувствуешь? (до ${T.limits.feeling} символов)`,[cancel]);
      case 'direct_need':return this.say(t,`Что тебе нужно или важно? (до ${T.limits.need} символов)`,[back]);
      case 'direct_request':return this.say(t,`О чём ты хочешь попросить? (до ${T.limits.request} символов)\n\nОтказ и границы сохранятся — это не превращение «нет» в «да».`,[back]);
      default:return this.say(t,T.texts.unknownInput);
    }
  }
  private nextAfterSituation(stage:Stage):Stage {return stage==='message'?'relationship':stage==='relationship'?'context':'goal';}
  private async situationInput(t:Turn,stage:'message'|'relationship'|'context',text:string) {
    const limit={message:T.limits.message,relationship:T.limits.relationship,context:T.limits.context}[stage];
    if(text.length>limit)return this.say(t,T.tooLong(limit,text.length));
    return this.step(t,this.nextAfterSituation(stage),{...t.dlg.draft,[stage]:text});
  }
  private async afterGoal(t:Turn,goal:GoalValue) {
    const d={...t.dlg.draft,goal};
    if(t.dlg.stage!=='goal')return this.say(t,T.texts.stale);
    if(!isDirect(d))return this.step(t,'guess',d);
    await this.go(t,'draft',d,{sessionId:null,roleplayId:null});
    return this.say(t,'Сначала попробуй сам: как бы ты сказал это прямо? Напиши свой вариант — или нажми «Сразу варианты».',[[b('Сразу варианты','da')],[b('Отмена','nav','cancel')]]);
  }
  private async guessInput(t:Turn,text:string) {
    const d=t.dlg.draft;
    if(d.emotions===undefined&&!d.unsure){
      const emotions=text.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
      if(!emotions.length||emotions.length>T.limits.emotions||emotions.some(e=>e.length>T.limits.emotion))return this.say(t,`Нужно до ${T.limits.emotions} эмоций через запятую, каждая до ${T.limits.emotion} символов.`);
      await this.go(t,'guess',{...d,emotions,evidenceQuotes:[],unsure:false});
      return this.say(t,`Какие слова в сообщении на это указывают? Пришли точную цитату (до ${T.limits.quotes}) или нажми «Готово».`,[[b('Готово','qd')],[b('Отмена','nav','cancel')]]);
    }
    if(!d.message?.includes(text))return this.say(t,'Такой цитаты нет в сообщении. Скопируй слова точно, как в тексте, или нажми «Готово».',[[b('Готово','qd')]]);
    const quotes=[...new Set([...(d.evidenceQuotes??[]),text])].slice(0,T.limits.quotes);
    const next={...d,evidenceQuotes:quotes};
    if(quotes.length>=T.limits.quotes)return this.showConfirm(t,next);
    await this.go(t,'guess',next);
    return this.say(t,`Добавлено цитат: ${quotes.length} из ${T.limits.quotes}. Ещё одну или «Готово».`,[[b('Готово','qd')]]);
  }
  private async directInput(t:Turn,stage:'direct_feeling'|'direct_need'|'direct_request',text:string) {
    const [field,limit,next]=({direct_feeling:['feeling',T.limits.feeling,'direct_need'],direct_need:['need',T.limits.need,'direct_request'],direct_request:['request',T.limits.request,'message']} as const)[stage];
    if(text.length>limit)return this.say(t,T.tooLong(limit,text.length));
    const d={...t.dlg.draft,[field]:text};
    return this.step(t,next==='message'&&d.message?'relationship':next,d);
  }

  // ---------- confirm before any generation
  private async showConfirm(t:Turn,d:Draft) {
    const direct=isDirect(d);
    await this.go(t,direct?'draft':'guess',d,{sessionId:null,roleplayId:null});
    return this.say(t,T.confirmation(d,direct),[[b('Отправить в модель','send')],[b('Изменить','edit'),b('Отмена','nav','cancel')]]);
  }
  /** Text that goes to the model inside an existing session (reply draft, exercise answer, roleplay turn). */
  private async ownText(t:Turn,text:string) {
    if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
    if(t.dlg.stage==='draft'&&!t.dlg.sessionId){await this.go(t,'draft',{...t.dlg.draft,draft:text});return this.showConfirm(t,t.dlg.draft);}
    await this.go(t,t.dlg.stage,{...t.dlg.draft,draft:text});
    const rows=[[b('Отправить в модель','send')],[b('Изменить','edit')],...(t.dlg.stage==='roleplay'?[[b('Завершить разговор','fin')]]:[])];
    return this.say(t,`Так текст уйдёт в модель:\n\n${text}\n\nПроверь имена, телефоны и адреса — автоматического скрытия пока нет.`,rows);
  }
  private async edit(t:Turn) {
    const d=t.dlg.draft;
    if(t.dlg.sessionId&&d.draft!==undefined){const {draft:_d,...rest}=d;void _d;await this.go(t,t.dlg.stage,rest);return this.say(t,'Напиши исправленный текст одним сообщением.');}
    // Situation edit restarts the steps with saved answers kept; each step re-asks, confirmation is invalidated by the new revision.
    if(isDirect(d))return this.step(t,'direct_feeling',d);
    const {emotions:_e,evidenceQuotes:_q,unsure:_u,...situation}=d;void _e;void _q;void _u;
    return this.step(t,'message',situation);
  }
  private async confirm(t:Turn) {
    const d=t.dlg.draft,stage=t.dlg.stage;
    if(t.dlg.sessionId&&d.draft!==undefined){
      const sid=t.dlg.sessionId,s=await this.domain.session(t.ctx,sid),content=d.draft;
      if(stage==='draft')return this.submit(t,sid,null,()=>this.domain.replyFeedback(t.ctx,sid,{expectedRevision:s.revision,draft:content},this.key(t,'reply_feedback')));
      if(stage==='exercise_answer'){
        const ex=s.runs.find(r=>r.kind==='exercise'&&r.status==='succeeded'&&r.revision===s.revision);
        if(!ex)return this.say(t,'Упражнение не найдено — начни его заново.',[[f('Упражнение','xs',sid)]]);
        return this.submit(t,sid,null,()=>this.domain.exerciseFeedback(t.ctx,sid,{expectedRevision:s.revision,exerciseRunId:ex.id,answer:content},this.key(t,'exercise_feedback')));
      }
      const rid=t.dlg.roleplayId;
      if(stage==='roleplay'&&rid)return this.submit(t,sid,rid,()=>this.domain.roleplayTurn(t.ctx,rid,{expectedRevision:s.revision,content},this.key(t,'roleplay_turn')));
      return this.say(t,T.texts.stale,menuRows());
    }
    if(!d.message||!d.relationship||!d.goal)return this.say(t,T.texts.stale,menuRows());
    const direct=isDirect(d);
    const session=await this.domain.createSession(t.ctx,{title:T.shortTitle(direct?`Сказать прямо: ${d.request??d.message}`:d.message,T.limits.title),
      situation:{message:d.message,relationship:d.relationship,context:d.context??'',goal:d.goal},
      guess:direct?{emotions:[],evidenceQuotes:[],unsure:true}:{emotions:d.emotions??[],evidenceQuotes:d.evidenceQuotes??[],unsure:d.unsure??false}},this.key(t,'create_session'));
    if(direct)return this.submit(t,session.id,null,()=>this.domain.sayDirect(t.ctx,session.id,{expectedRevision:session.revision,feeling:d.feeling!,need:d.need!,request:d.request!,...(d.draft?{draft:d.draft}:{})},this.key(t,'say_direct')));
    return this.submit(t,session.id,null,()=>this.domain.analyze(t.ctx,session.id,{expectedRevision:session.revision},this.key(t,'analyze')));
  }

  // ---------- runs
  private async submit(t:Turn,sid:string,roleplay:string|null|'new',call:()=>Promise<{runId:string;resourceId?:string}>) {
    const accepted=await call();
    const roleplayId=roleplay==='new'?accepted.resourceId??null:roleplay;
    await this.go(t,'waiting_run',{},{sessionId:sid,roleplayId});
    return this.say(t,T.texts.accepted);
  }
  private async withSession(t:Turn,sid:string,work:(s:Awaited<ReturnType<DomainFacade['session']>>)=>Promise<unknown>) {return work(await this.domain.session(t.ctx,sid));}
  private async withRun(t:Turn,runId:string,work:(r:DomainRun)=>Promise<unknown>) {return work(await this.domain.run(t.ctx,runId));}
  private async continueRoleplay(t:Turn,sid:string) {
    const s=await this.domain.session(t.ctx,sid);
    const role=s.roleplays.find(r=>r.status==='active'),last=role?.messages.filter(m=>m.role==='assistant').at(-1);
    if(!role||!last)return this.say(t,'Активного разговора нет.',[[f('Начать тренировку','rp',sid),toMenu]]);
    await this.go(t,'roleplay',{},{sessionId:sid,roleplayId:role.id});
    return this.say(t,T.roleplayMessage(last.content,role.turnCount),role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);
  }

  // ---------- history
  private async history(t:Turn,page:number) {
    const known=this.cursors.get(t.ctx.accountId)??[null];
    if(page>0&&known[page]===undefined)page=0;
    const cursor=known[page]??undefined;
    const result=await this.domain.sessions(t.ctx,{limit:HISTORY_PAGE,...(cursor?{cursor}:{})});
    const next=known.slice(0,page+1);if(result.nextCursor)next[page+1]=result.nextCursor;
    this.cursors.set(t.ctx.accountId,next);
    if(!result.items.length&&page===0)return this.say(t,'Пока нет сохранённых разборов.',[[f('Понять сообщение','m','u')],[toMenu]]);
    const n=(i:number)=>page*HISTORY_PAGE+i+1;
    const lines=result.items.map((s,i)=>`${n(i)}. ${T.shortTitle(s.title)} — ${new Date(s.updatedAt).toLocaleDateString('ru-RU',{timeZone:'UTC'})}`);
    const nav=[...(page>0?[f('← Назад','hn',String(page-1))]:[]),...(result.nextCursor?[f('Дальше →','hn',String(page+1))]:[])];
    return this.say(t,`История · страница ${page+1}\n\n${lines.join('\n')}`,[...result.items.map((s,i)=>[f(`${n(i)}. ${T.shortTitle(s.title,40)}`,'ho',s.id)]),...(nav.length?[nav]:[]),[toMenu]]);
  }
  private async openSession(t:Turn,sid:string) {
    const s=await this.domain.session(t.ctx,sid);
    const analysis=s.runs.find(r=>r.kind==='analysis'),direct=s.runs.find(r=>r.kind==='say_direct'),role=s.roleplays.find(r=>r.status==='active');
    const main=direct??analysis;
    const status=!main?'Разбор ещё не запускался.':main.status==='pending'?'Запрос выполняется — результат придёт сюда.':main.status==='failed'?`Не удалось: ${T.runFailure[main.errorCode]??''}`:'Результат готов.';
    const rows:Rows=[];
    if(direct?.status==='succeeded')rows.push([f('Показать результат','ha',sid)]);
    else if(analysis?.status==='succeeded')rows.push([f('Показать разбор','ha',sid),f('Как уточнить?','cl',analysis.id)],[f('Написать ответ','rw',sid),f('Упражнение','xs',sid)],[f(role?'Продолжить разговор':'Потренировать разговор',role?'rc':'rp',sid)]);
    else if(main?.status==='failed')rows.push([f('Повторить','rt',main.id)]);
    else if(!main)rows.push([f('Запустить разбор','hr',sid)]);
    rows.push([f('Удалить','hd',sid),f('К истории','m','h')]);
    const sit=s.situation;
    return this.say(t,`${s.title}\n${new Date(s.updatedAt).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC\n\nТекст: «${sit.message}»\nСобеседник: ${sit.relationship}\nЦель: ${T.goalLabels[sit.goal]}${sit.context?`\nКонтекст: ${sit.context}`:''}\n\n${status}`,rows);
  }
  private async showAnalysis(t:Turn,sid:string) {
    const s=await this.domain.session(t.ctx,sid);
    for(const run of s.runs){
      if(run.kind==='say_direct'&&run.status==='succeeded')return this.say(t,T.sayDirect(run.output),[[toMenu]]);
      if(run.kind==='analysis'&&run.status==='succeeded')return this.say(t,T.analysis(run.output),this.analysisRows(sid,run.id));
    }
    return this.say(t,'Готового результата нет.',[[f('Запустить разбор','hr',sid)]]);
  }
  private analysisRows(sid:string,runId:string):Rows {
    return [[f('Как уточнить?','cl',runId)],[f('Написать ответ','rw',sid),f('Упражнение','xs',sid)],[f('Потренировать разговор','rp',sid)],[toMenu]];
  }

  // ---------- delivery of finished runs (outbox worker; never generates)
  async deliver(t:Turn,delivery:DomainDelivery) {
    const run=delivery.run,waiting=t.dlg.stage==='waiting_run'&&t.dlg.sessionId===run.sessionId;
    const toMenuStage=async()=>{if(waiting)await this.go(t,'menu',{},{sessionId:run.sessionId,roleplayId:null});};
    if(run.status==='pending')return;
    if(run.status==='failed'){
      await toMenuStage();
      return this.say(t,`${T.runFailure[run.errorCode]??'Не удалось получить ответ модели.'} Сохранённые данные не потеряны.`,[[f('Повторить','rt',run.id)],[toMenu]]);
    }
    switch(run.kind){
      case 'analysis':await toMenuStage();return this.say(t,T.analysis(run.output),this.analysisRows(run.sessionId,run.id));
      case 'reply_feedback':await toMenuStage();return this.say(t,T.replyFeedback(run.output),[[f('Другой черновик','rw',run.sessionId),toMenu]]);
      case 'reply_examples':await toMenuStage();return this.say(t,`Примеры под разные цели:\n\n${T.options(run.output)}`,[[f('Написать свой вариант','rw',run.sessionId)],[toMenu]]);
      case 'exercise':
        if(waiting){await this.go(t,'exercise_answer',{},{sessionId:run.sessionId,roleplayId:null});return this.say(t,T.exercise(run.output),[[toMenu]]);}
        return this.say(t,T.exercise(run.output),[[f('Ответить на упражнение','xa',run.id)],[toMenu]]);
      case 'exercise_feedback':await toMenuStage();return this.say(t,T.exerciseFeedback(run.output),[[f('Ещё упражнение','xs',run.sessionId),toMenu]]);
      case 'say_direct':await toMenuStage();return this.say(t,T.sayDirect(run.output),[[f('Новая фраза','m','d'),toMenu]]);
      case 'roleplay_start':case 'roleplay_turn':case 'roleplay_feedback':{
        const out=run.output;
        if(out.kind==='feedback'){await toMenuStage();return this.say(t,T.roleplayFeedback(out),[[f('Ещё тренировка','rp',run.sessionId),toMenu]]);}
        const s=await this.domain.session(t.ctx,run.sessionId),role=s.roleplays.find(r=>r.status==='active');
        if(!role)return this.say(t,`Собеседник:\n${out.content}`,[[toMenu]]);
        if(waiting){await this.go(t,'roleplay',{},{sessionId:run.sessionId,roleplayId:role.id});return this.say(t,T.roleplayMessage(out.content,role.turnCount),role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);}
        return this.say(t,`Собеседник:\n${out.content}`,[[f('Продолжить разговор','rc',run.sessionId)]]);
      }
    }
  }
}
