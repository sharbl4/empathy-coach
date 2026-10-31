import type {z} from 'zod';
import {normalizeDomainError,type Account,type EmailVerificationStatus,type ComposerDraft,type ContextType,type Delivery,type Difficulty,type DialogueV2,type Goal,type LearningMode,type PreviewSource,type ProductFacade,type RunV2,type SessionInputV2,type UserContext} from '@between/contracts/product';
import {type Callback,intentKey} from './callbacks.js';
import type {TelegramApi} from './telegram.js';
import * as T from './text.js';
import {type Rows,b,f,menuRows,send,toMenu} from './ui.js';

type Draft=z.infer<typeof ComposerDraft>;
type Dlg=z.infer<typeof DialogueV2>;
type Step=Dlg['step'];
type AccountValue=z.infer<typeof Account>;
type Status=z.infer<typeof EmailVerificationStatus>;
type Run=z.infer<typeof RunV2>;
type Mode=z.infer<typeof LearningMode>;
type Ctx=z.infer<typeof ContextType>;
type GoalValue=z.infer<typeof Goal>;
type Source=z.infer<typeof PreviewSource>;

export interface Turn {
  tg:TelegramApi;ctx:UserContext;chat:string;account:AccountValue;dlg:Dlg;
  /** Stable per Telegram update (UpdateReceipt.intentKey) or delivery id; sub-keys derive from it. */
  intent:string;seq:number;
}

/** Shared contract normalizer: unknown errors become INTERNAL_ERROR, never a retryable dependency failure. */
export const failureCode=(error:unknown)=>normalizeDomainError(error,'bot').code;
/**
 * Escalate to the poller (recordUpdateFailure decides retry_wait or failed) only for infrastructure failures
 * and unknown errors; every other domain code is a definite outcome explained to the user.
 */
export const escalates=(error:unknown)=>{const code=failureCode(error);return code==='DEPENDENCY_UNAVAILABLE'||code==='INTERNAL_ERROR';};

const POLICY='web-telegram-2';
const GOALS:GoalValue[]=['support','clarify','reconcile','boundary'];
const CONTEXTS:Ctx[]=['close','colleague','teacher','client'];
const LEVELS:z.infer<typeof Difficulty>[]=['calm','hurt','irritated'];
const HISTORY_PAGE=5;
const EMAIL=/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const CLOCK=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ready=(a:AccountValue)=>a.consentVersion===POLICY&&a.emailVerified&&a.onboardingCompletedAt!==null;
const OPEN_OPS=new Set(['ok','rs','ce','ac','ay','help','nav']);
/** Field order of the composer per mode; the first missing field is the current question. */
const ORDER:Record<Mode,(keyof Draft)[]>={
  understand:['message','relationship','contextType','context','goal'],
  thread:['relationship','contextType','context','goal'],
  say_direct:['draft','intent','relationship','contextType','context','goal'],
  before_send:['draft','relationship','contextType','context','goal'],
};
const nextField=(d:Draft)=>d.mode?ORDER[d.mode].find(k=>d[k]===undefined):undefined;
const sourceKind=(mode:Mode)=>mode==='understand'||mode==='thread'?'analysis' as const:mode;

/** Navigation-only memory (not learning data). Lost on restart; every path then asks again. Contract gaps are listed in README. */
interface Memo {editingField?:string;speaker?:'self'|'other';cardId?:string;reminderField?:'time'|'timezone'|'quiet';assessment?:{id:string;kind:'baseline'|'followup';answers:{questionId:string;choiceId:string}[]};cursors?:(string|null)[];historyFilter?:Ctx|null}

export class Flows {
  private memo=new Map<string,Memo>();
  constructor(private domain:ProductFacade) {}

  // ---------- helpers
  private m(t:Turn) {let v=this.memo.get(t.ctx.accountId);if(!v){v={};this.memo.set(t.ctx.accountId,v);}return v;}
  key(t:Turn,label:string) {return intentKey(t.intent,label,t.seq++);}
  private say(t:Turn,text:string,rows:Rows=[]) {return send(t.tg,t.chat,text,rows,t.dlg.revision);}
  private async go(t:Turn,step:Step,draft:Draft={},refs:{sessionId?:string|null;previewId?:string|null;roleplayId?:string|null}={}) {
    t.dlg=await this.domain.updateDialogue(t.ctx,{expectedRevision:t.dlg.revision,step,draft,
      sessionId:refs.sessionId===undefined?t.dlg.sessionId:refs.sessionId,previewId:refs.previewId===undefined?t.dlg.previewId:refs.previewId,roleplayId:refs.roleplayId===undefined?t.dlg.roleplayId:refs.roleplayId},this.key(t,'dialogue'));
    return t.dlg;
  }
  private async reset(t:Turn) {t.dlg=await this.domain.resetDialogue(t.ctx,{expectedRevision:t.dlg.revision},this.key(t,'reset'));return t.dlg;}
  async menu(t:Turn,prefix?:string,page=0) {
    const m=this.m(t);delete m.editingField;delete m.speaker;delete m.cardId;delete m.reminderField;
    await this.go(t,'menu',{},{sessionId:null,previewId:null,roleplayId:null});
    await this.say(t,prefix?`${prefix}\n\n${T.texts.menu}`:T.texts.menu,menuRows(page));
  }

  /** Definite domain outcome → user-facing text. Transient failures are rethrown so the update is retried, not acknowledged. */
  async explain(t:Turn,error:unknown) {
    if(escalates(error))throw error;
    const retry=normalizeDomainError(error,'bot').retryAfterSeconds;
    switch(failureCode(error)){
      case 'REVISION_CONFLICT':{t.dlg=await this.domain.dialogue(t.ctx,{});return this.say(t,T.texts.conflict,menuRows());}
      case 'IDEMPOTENCY_CONFLICT':{t.dlg=await this.domain.dialogue(t.ctx,{});return this.say(t,T.texts.stale,menuRows());}
      case 'NOT_FOUND':return this.say(t,T.texts.notFound,[[toMenu]]);
      case 'OPERATION_IN_PROGRESS':return this.say(t,T.texts.busy);
      case 'RATE_LIMITED':return this.say(t,retry?`${T.texts.rateLimited} Можно через ${retry} с.`:T.texts.rateLimited,[[toMenu]]);
      case 'EMAIL_NOT_VERIFIED':return this.say(t,T.texts.needVerify);
      case 'CONSENT_REQUIRED':return this.say(t,T.texts.needConsent,[[f('Аккаунт','m','a')]]);
      case 'CODE_INVALID':case 'CODE_EXPIRED':return this.emailStatus(t,await this.domain.emailVerification(t.ctx,{}),failureCode(error)==='CODE_INVALID'?'Код не подошёл.':'Срок кода истёк.');
      case 'PREVIEW_STALE':case 'PREVIEW_NOT_CONFIRMED':return this.say(t,T.texts.previewStale,[[f('История','m','h'),toMenu]]);
      case 'INPUT_TOO_LARGE':return this.say(t,T.texts.tooLarge,[[toMenu]]);
      case 'ASSESSMENT_NOT_DUE':return this.say(t,'Повторный тест пока недоступен — он откроется через 7 дней после входного.',[[toMenu]]);
      case 'UNAUTHORIZED':case 'FORBIDDEN':return this.say(t,'Нужно заново начать: отправь /start.');
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
        const waiting=t.dlg.step==='waiting_run';
        if(!ready(t.account))return this.resumeOnboarding(t);
        return this.menu(t,waiting?'Уже запущенный запрос не отменяется — результат придёт сюда.':T.texts.cancelled);
      }
      if(!ready(t.account))return this.resumeOnboarding(t);
      if(cmd==='menu')return this.menu(t);
      if(cmd==='history')return this.history(t,0,null);
      return this.say(t,`Не знаю такой команды.\n\n${T.texts.help}`);
    });
  }

  async text(t:Turn,raw:string) {
    return this.guard(t,async()=>{
      const text=raw.trim(),step=t.dlg.step,m=this.m(t);
      if(step==='email')return this.emailInput(t,text);
      if(step==='email_code')return this.codeInput(t,text);
      if(!ready(t.account))return this.resumeOnboarding(t);
      switch(step){
        case 'compose':return this.composeInput(t,text);
        case 'guess':return this.guessInput(t,text);
        case 'preview':return m.editingField?this.applyEdit(t,text):this.say(t,'Чтобы исправить поле, нажми «Изменить» и выбери его. Черновик сохранён.');
        case 'exercise':return this.exerciseAnswer(t,text);
        case 'roleplay':return this.roleplayTurn(t,text);
        case 'settings':return this.reminderInput(t,text);
        case 'waiting_run':return this.say(t,`${T.texts.busy} /menu — главное меню.`);
        case 'menu':{
          if(text.length>T.limits.message)return this.say(t,T.tooLong(T.limits.message,text.length));
          await this.go(t,'menu',{message:text,draft:text},{sessionId:null,previewId:null,roleplayId:null});
          return this.say(t,'Что сделать с этим текстом?',[[b('Понять сообщение','pick','understand'),b('Проверить мой черновик','pick','before_send')],[b('Сказать прямо','pick','say_direct'),toMenu]]);
        }
        default:return this.say(t,T.texts.unknownInput);
      }
    });
  }

  async callback(t:Turn,cb:Callback|null) {
    return this.guard(t,async()=>{
      if(!cb||(cb.version!==null&&cb.version!==t.dlg.revision))return this.say(t,T.texts.stale,ready(t.account)?menuRows():[]);
      if(!ready(t.account)&&!OPEN_OPS.has(cb.op))return this.resumeOnboarding(t);
      const base=cb.op.replace(/\d+$/,''),index=Number(cb.op.match(/\d+$/)?.[0]??0);
      const handler=this.ops[base];
      if(!handler)return this.say(t,T.texts.stale,menuRows());
      return handler(t,cb.arg,index);
    });
  }

  private ops:Record<string,(t:Turn,arg:string,n:number)=>Promise<unknown>>={
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
    pick:(t,arg)=>{const d=t.dlg.draft;const mode=arg as Mode;if(!ORDER[mode])return this.say(t,T.texts.stale);
      return this.compose(t,mode==='understand'?{mode,...(d.message?{message:d.message}:{})}:{mode,...(d.draft?{draft:d.draft}:{})});},
    exs:(t,id)=>this.pickExample(t,id),
    // composer
    ct:(t,arg)=>CONTEXTS.includes(arg as Ctx)&&t.dlg.step==='compose'?this.compose(t,{...t.dlg.draft,contextType:arg as Ctx}):this.say(t,T.texts.stale),
    g:(t,arg)=>GOALS.includes(arg as GoalValue)&&t.dlg.step==='compose'?this.compose(t,{...t.dlg.draft,goal:arg as GoalValue}):this.say(t,T.texts.stale),
    sp:(t,arg)=>{if(arg!=='self'&&arg!=='other')return this.say(t,T.texts.stale);this.m(t).speaker=arg;return this.say(t,`Пришли текст реплики ${arg==='self'?'(твоей)':'(собеседника)'} одним сообщением, до ${T.limits.text} символов.`);},
    tdel:t=>{const turns=t.dlg.draft.turns??[];if(!turns.length)return this.say(t,T.texts.stale);const rest=turns.slice(0,-1);return this.compose(t,{...t.dlg.draft,...(rest.length?{turns:rest}:{turns:undefined})});},
    tdone:t=>(t.dlg.draft.turns?.length?this.toGuess(t,t.dlg.draft):this.say(t,'Добавь хотя бы одну реплику.')),
    ns:t=>this.finishCompose(t,{...t.dlg.draft,guess:{emotions:[],quotes:[],unsure:true}}),
    qd:t=>this.finishCompose(t,t.dlg.draft),
    // preview
    send:t=>this.confirm(t),
    edit:t=>this.editMenu(t),
    ef:(t,fieldId)=>{this.m(t).editingField=fieldId;return this.say(t,'Пришли новый текст этого поля одним сообщением. После правки будет новый предпросмотр, старое подтверждение сбросится.');},
    // results
    rw:(t,sid)=>this.withSession(t,sid,()=>this.go(t,'compose',{},{sessionId:sid,previewId:null,roleplayId:null}).then(()=>this.say(t,`Напиши свой черновик ответа (до ${T.limits.text} символов). Сначала свой вариант — так полезнее.\n\nЕсли не знаешь, с чего начать, нажми «Нужен пример».`,[[b('Нужен пример','rx',sid)],[toMenu]]))),
    rx:(t,sid)=>this.withSession(t,sid,s=>this.previewFor(t,{kind:'reply_examples',sessionId:sid,expectedRevision:s.revision})),
    xs:(t,sid)=>this.withSession(t,sid,s=>this.previewFor(t,{kind:'exercise',sessionId:sid,expectedRevision:s.revision})),
    xa:(t,runId)=>this.withRun(t,runId,run=>run.kind!=='exercise'||run.status!=='succeeded'||!run.sessionId?this.say(t,T.texts.stale,menuRows()):
      this.go(t,'exercise',{},{sessionId:run.sessionId,previewId:null,roleplayId:null}).then(()=>this.say(t,`Напиши свою попытку одним сообщением (до ${T.limits.text} символов).`))),
    cq:(t,sid)=>this.withSession(t,sid,s=>this.previewFor(t,{kind:'clarify',sessionId:sid,expectedRevision:s.revision})),
    rp:(t,sid)=>this.withSession(t,sid,()=>this.go(t,'roleplay',{},{sessionId:sid,previewId:null,roleplayId:null}).then(()=>this.say(t,'Каким будет собеседник? Реакции будут зависеть и от уровня, и от твоих ответов. Три твоих ответа, закончить можно раньше.',[LEVELS.map(l=>b(T.difficultyLabels[l],'lv',l)),[toMenu]]))),
    lv:(t,arg)=>{const sid=t.dlg.sessionId;if(!sid||!LEVELS.includes(arg as typeof LEVELS[number]))return this.say(t,T.texts.stale);
      return this.withSession(t,sid,s=>this.previewFor(t,{kind:'roleplay_start',sessionId:sid,expectedRevision:s.revision,difficulty:arg as typeof LEVELS[number]}));},
    fin:t=>{const sid=t.dlg.sessionId,rid=t.dlg.roleplayId;if(t.dlg.step!=='roleplay'||!sid||!rid)return this.say(t,T.texts.stale,menuRows());
      return this.withSession(t,sid,s=>this.previewFor(t,{kind:'roleplay_feedback',roleplayId:rid,expectedRevision:s.revision}));},
    rc:(t,sid)=>this.continueRoleplay(t,sid),
    cl:(t,runId)=>this.withRun(t,runId,run=>run.kind==='analysis'&&run.status==='succeeded'?this.say(t,T.clarify(run.output),[...(run.sessionId?[[f('Ещё варианты вопроса','cq',run.sessionId)]]:[]),[toMenu]]):this.say(t,T.texts.notFound)),
    pw:(t,runId,n)=>this.withRun(t,runId,run=>(run.kind==='reply_feedback'||run.kind==='before_send')&&run.status==='succeeded'?this.say(t,T.phraseDetail(run.output,n)??T.texts.notFound):this.say(t,T.texts.notFound)),
    up:(t,runId)=>this.rate(t,runId,'useful'),
    un:(t,runId)=>this.rate(t,runId,'not_useful'),
    rt:(t,runId)=>this.withRun(t,runId,async run=>{
      if(run.status!=='failed')return this.say(t,T.texts.stale,menuRows());
      // Retry reuses exactly the confirmed snapshot of the failed run; a changed preview fails as PREVIEW_STALE.
      const p=await this.domain.preview(t.ctx,{id:run.previewId});
      return this.started(t,run.sessionId,this.domain.retry(t.ctx,{id:runId,previewId:run.previewId,previewRevision:run.previewRevision,snapshotHash:p.snapshotHash,expectedRevision:run.revision},this.key(t,'retry')));
    }),
    // history
    hn:(t,arg)=>this.history(t,Number(arg)||0,this.m(t).historyFilter??null),
    hf:(t,arg)=>this.history(t,0,CONTEXTS.includes(arg as Ctx)?arg as Ctx:null),
    ho:(t,sid)=>this.openSession(t,sid),
    ha:(t,sid)=>this.showResult(t,sid),
    hr:(t,sid)=>this.withSession(t,sid,s=>this.previewFor(t,{kind:sourceKind(s.input.mode),sessionId:sid,expectedRevision:s.revision})),
    hd:(t,sid)=>this.withSession(t,sid,s=>this.reset(t).then(()=>this.say(t,`Удалить «${T.shortTitle(s.input.title)}»?\n\nИз приложения (и в боте, и на сайте) удалятся ситуация, разборы и практика по ней. Сообщения в этом чате Telegram останутся — их можно удалить только в самом Telegram.`,[[b('Да, удалить','hy',sid),f('Нет','ho',sid)]]))),
    hy:(t,sid)=>this.withSession(t,sid,async s=>{await this.domain.deleteSession(t.ctx,{id:sid,expectedRevision:s.revision},this.key(t,'delete_session'));await this.say(t,'Удалено из приложения.');return this.history(t,0,null);}),
    // practice, cards, assessment, reminders, web
    pdone:t=>this.completePractice(t),
    co:(t,id)=>this.openCard(t,id),
    cc:(t,id)=>this.completeCard(t,id),
    ctry:(t,id)=>this.domain.card(t.ctx,{id}).then(c=>{this.m(t).cardId=c.id;return this.go(t,'compose',{},{sessionId:null,previewId:null,roleplayId:null}).then(()=>this.say(t,`Попробуй:\n${c.practice}\n\nНапиши свою попытку одним сообщением.`));}),
    ts:(t,kind)=>this.startAssessment(t,kind==='followup'?'followup':'baseline'),
    aa:(t,arg,n)=>this.answerAssessment(t,Number(arg),n),
    rm:(t,arg)=>this.reminderAction(t,arg),
    wl:t=>this.issueWebLink(t)
  };

  // ---------- onboarding: account → consent → email → code → onboarding
  private async start(t:Turn) {
    if(ready(t.account))return this.menu(t,'С возвращением!');
    await this.say(t,T.texts.greeting);
    await this.domain.recordStage(t.ctx,{name:'onboarding_started'},this.key(t,'stage')).catch(error=>{if(escalates(error))throw error;});
    return this.resumeOnboarding(t);
  }
  async resumeOnboarding(t:Turn):Promise<unknown> {
    const a=t.account;
    if(a.consentVersion!==POLICY){if(t.dlg.step!=='onboarding')await this.go(t,'onboarding');return this.say(t,T.texts.onboarding,[[b('Принимаю, продолжить','ok')],[f('Справка','help')]]);}
    if(!a.emailVerified){
      // Authoritative state comes from the domain DB, not process memory: works after restart.
      const status=await this.domain.emailVerification(t.ctx,{});
      if(status.state==='challenge'&&t.dlg.step!=='email')return this.emailStatus(t,status);
      if(t.dlg.step!=='email')await this.go(t,'email');
      return this.say(t,T.texts.askEmail,[[f('Удалить аккаунт','ac','del')]]);
    }
    t.account=await this.domain.updateAccount(t.ctx,{onboardingCompleted:true},this.key(t,'onboarding'));
    await this.domain.recordStage(t.ctx,{name:'onboarding_completed'},this.key(t,'stage')).catch(error=>{if(escalates(error))throw error;});
    return this.menu(t,'Готово, аккаунт подтверждён.');
  }
  private async acceptConsent(t:Turn) {
    t.account=await this.domain.acceptConsent(t.ctx,{policyVersion:POLICY,accepted:true},this.key(t,'consent'));
    return this.resumeOnboarding(t);
  }
  private async emailInput(t:Turn,email:string) {
    if(email.length>254||!EMAIL.test(email))return this.say(t,'Это не похоже на адрес почты. Пример: name@example.com');
    return this.emailStatus(t,await this.domain.requestEmailCode(t.ctx,{email},this.key(t,'email_code')));
  }
  /** Resend targets the current owned challenge; the address is never asked again or taken from a callback. */
  private async resend(t:Turn) {
    const status=await this.domain.emailVerification(t.ctx,{});
    if(status.state!=='challenge'){await this.go(t,'email');return this.say(t,T.texts.askEmail);}
    try{return this.emailStatus(t,await this.domain.resendEmailCode(t.ctx,{challengeId:status.challenge.challengeId},this.key(t,'email_resend')));}
    catch(error){if(failureCode(error)==='RATE_LIMITED'||failureCode(error)==='REVISION_CONFLICT')return this.emailStatus(t,await this.domain.emailVerification(t.ctx,{}),'Новый код пока отправить нельзя.');throw error;}
  }
  /** Renders server state honestly: «sent» only for state=sent; cooldown and attempts come from the server. */
  private async emailStatus(t:Turn,status:Status,prefix?:string):Promise<unknown> {
    if(status.state==='verified'){t.account=await this.domain.account(t.ctx,{});return this.resumeOnboarding(t);}
    if(status.state==='none'){await this.go(t,'email');return this.say(t,`${prefix?`${prefix}\n\n`:''}${T.texts.askEmail}`);}
    const c=status.challenge;
    if(t.dlg.step!=='email_code')await this.go(t,'email_code');
    const wait=Math.ceil((Date.parse(c.resendAfter)-Date.now())/1000);
    const resend=wait>0?`Новый код можно запросить через ${wait} с.`:'Можно запросить новый код.';
    const body:Record<typeof c.state,string>={
      sending:`Отправляем код на ${c.maskedEmail}… Если письмо придёт, введи 6 цифр сюда.`,
      sent:`Код отправлен на ${c.maskedEmail}. Введи 6 цифр сюда. Действует до ${new Date(c.expiresAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}.`,
      delivery_unknown:`Не удалось подтвердить, что письмо на ${c.maskedEmail} ушло. Если оно пришло — введи код; иначе запроси новый.`,
      failed:`Письмо на ${c.maskedEmail} не отправилось. Запроси код ещё раз или смени адрес.`,
      expired:'Срок кода истёк. Запроси новый.',
      locked:'Попытки ввода закончились. Запроси новый код.'
    };
    const attempts=c.state==='sent'||c.state==='delivery_unknown'||c.state==='sending'?`\nОсталось попыток: ${c.attemptsRemaining}.`:'';
    return this.say(t,`${prefix?`${prefix}\n\n`:''}${body[c.state]}${attempts}\n${resend}`,[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')],[f('Удалить аккаунт','ac','del')]]);
  }
  private async codeInput(t:Turn,code:string) {
    if(!/^\d{6}$/.test(code))return this.say(t,'Код — это 6 цифр из письма. Введи их одним сообщением.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
    const status=await this.domain.emailVerification(t.ctx,{});
    if(status.state!=='challenge')return this.emailStatus(t,status);
    try{
      const result=await this.domain.verifyEmailCode(t.ctx,{challengeId:status.challenge.challengeId,code},this.key(t,'verify'));
      t.account=result.account;
    }catch(error){
      const code=failureCode(error);
      if(code==='CODE_INVALID'||code==='CODE_EXPIRED'||code==='REVISION_CONFLICT'||code==='OPERATION_IN_PROGRESS')
        return this.emailStatus(t,await this.domain.emailVerification(t.ctx,{}),code==='CODE_INVALID'?'Код не подошёл.':code==='CODE_EXPIRED'?'Срок кода истёк.':code==='OPERATION_IN_PROGRESS'?'Письмо ещё отправляется — попробуй через минуту.':'Этот код уже заменён новым.');
      throw error;
    }
    await this.say(t,'Почта подтверждена.');
    return this.resumeOnboarding(t);
  }

  // ---------- account and settings
  async accountView(t:Turn) {
    const a=t.account=await this.domain.account(t.ctx,{});
    const lines=[`Почта: ${a.emailVerified?'подтверждена':'не подтверждена'}`,`Согласие на обработку: ${a.consentVersion?`дано (${a.consentVersion})`:'нет'}`,'Вход — по твоему Telegram-аккаунту, пароль не нужен.'];
    const rows:Rows=a.emailVerified&&a.consentVersion===POLICY?[[f('Открыть веб','wl'),f('Веб-сессии','ac','sessions')],[f('Напоминания','m','rem'),f('Сменить почту','ac','email')],[f('Удалить учебные данные','ac','data')],[f('Отозвать согласие','ac','consent'),f('Удалить аккаунт','ac','del')],[toMenu]]:[[f('Удалить аккаунт','ac','del')]];
    return this.say(t,`Аккаунт\n\n${lines.join('\n')}`,rows);
  }
  private async accountAction(t:Turn,arg:string) {
    if(arg==='email'){await this.go(t,'email');return this.say(t,'Напиши новый адрес. История останется в этом Telegram-аккаунте; новый адрес нужно подтвердить кодом.',[[b('Отмена','nav','cancel')]]);}
    if(arg==='sessions'){
      const page=await this.domain.webSessions(t.ctx,{limit:10});
      const lines=page.items.map(s=>`• ${new Date(s.createdAt).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC, до ${new Date(s.expiresAt).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC`);
      return this.say(t,page.items.length?`Активные входы на сайт:\n${lines.join('\n')}`:'Активных входов на сайт нет.',page.items.length?[[f('Выйти на всех сайтах','ac','revoke')],[toMenu]]:[[toMenu]]);
    }
    if(arg==='revoke'){await this.domain.revokeAllWebSessions(t.ctx,this.key(t,'revoke_web'));const page=await this.domain.webSessions(t.ctx,{limit:1});return this.say(t,page.items.length?'Не все сессии удалось завершить — попробуй ещё раз.':'Все входы на сайт завершены.',[[toMenu]]);}
    const confirm:Record<string,[string,string]>={
      data:['Удалить учебные данные?\n\nУдалятся все ситуации, разборы, ответы, упражнения, диалоги, практика, карточки, тесты и прогресс в приложении — и в боте, и на сайте. Аккаунт и почта останутся.','Да, удалить учебные данные'],
      del:['Удалить аккаунт?\n\nУдалятся аккаунт, почта, входы на сайт, напоминания и все учебные данные приложения. Начать заново можно командой /start.','Да, удалить аккаунт'],
      consent:['Отозвать согласие?\n\nНовые разборы станут недоступны. Сохранённые данные останутся, пока ты их не удалишь.','Да, отозвать']
    };
    const c=confirm[arg];if(!c)return this.say(t,T.texts.stale);
    await this.reset(t);
    return this.say(t,`${c[0]}\n\nСообщения в этом чате Telegram это не удалит — их можно удалить только в самом Telegram. Резервные копии сервера очищаются по их сроку хранения, не мгновенно.`,[[b(c[1],'ay',arg)],[b('Отмена','nav','cancel')]]);
  }
  private async accountConfirm(t:Turn,arg:string) {
    if(arg==='data'){await this.domain.deleteData(t.ctx,{confirmation:'DELETE_MY_LEARNING_DATA'},this.key(t,'delete_data'));return this.menu(t,'Учебные данные удалены. Аккаунт сохранён.');}
    if(arg==='consent'){await this.domain.revokeConsent(t.ctx,{},this.key(t,'revoke'));t.account=await this.domain.account(t.ctx,{});return this.resumeOnboarding(t);}
    if(arg==='del'){await this.domain.deleteAccount(t.ctx,{confirmation:'DELETE_MY_ACCOUNT'},this.key(t,'delete_account'));this.memo.delete(t.ctx.accountId);return send(t.tg,t.chat,'Аккаунт и данные приложения удалены. Чтобы начать заново, отправь /start.');}
    return this.say(t,T.texts.stale);
  }
  private async issueWebLink(t:Turn) {
    const link=await this.domain.issueWebLink(t.ctx,this.key(t,'web_link'));
    // Bearer link: plain text, link preview disabled by the client, never logged.
    return this.say(t,T.webLink(link.webUrl),[[toMenu]]);
  }
  private async reminderView(t:Turn) {
    const r=await this.domain.reminders(t.ctx,{});
    await this.go(t,'settings',{},{sessionId:null,previewId:null,roleplayId:null});
    return this.say(t,T.reminders(r),[[b(r.enabled?'Выключить':'Включить','rm','toggle')],[b('Время','rm','time'),b('Часовой пояс','rm','timezone')],[b('Тихие часы','rm','quiet'),b(r.quietHours.enabled?'Без тихих часов':'Тихие часы 22:00–08:00','rm','quiet_toggle')],[toMenu]]);
  }
  private async reminderAction(t:Turn,arg:string) {
    if(arg==='time'||arg==='timezone'||arg==='quiet'){
      this.m(t).reminderField=arg;
      return this.say(t,{time:'Во сколько напоминать? Формат ЧЧ:ММ, например 19:00.',timezone:'Напиши часовой пояс в формате IANA, например Europe/Moscow или Asia/Novosibirsk.',quiet:'Тихие часы в формате ЧЧ:ММ-ЧЧ:ММ, например 22:00-08:00.'}[arg]);
    }
    const r=await this.domain.reminders(t.ctx,{});
    const patch={expectedRevision:r.revision,enabled:r.enabled,timezone:r.timezone,localTime:r.localTime,quietHours:r.quietHours};
    if(arg==='toggle')patch.enabled=!r.enabled;
    else if(arg==='quiet_toggle')patch.quietHours=r.quietHours.enabled?{...r.quietHours,enabled:false}:{enabled:true,start:'22:00',end:'08:00'};
    else return this.say(t,T.texts.stale);
    await this.domain.updateReminders(t.ctx,patch,this.key(t,'reminders'));
    return this.reminderView(t);
  }
  private async reminderInput(t:Turn,text:string) {
    const field=this.m(t).reminderField;
    if(!field)return this.say(t,'Выбери, что изменить, кнопкой ниже.');
    const r=await this.domain.reminders(t.ctx,{});
    const patch={expectedRevision:r.revision,enabled:r.enabled,timezone:r.timezone,localTime:r.localTime,quietHours:r.quietHours};
    if(field==='time'){if(!CLOCK.test(text))return this.say(t,'Нужен формат ЧЧ:ММ, например 19:00.');patch.localTime=text;}
    else if(field==='timezone'){try{new Intl.DateTimeFormat('en',{timeZone:text});}catch{return this.say(t,'Такой часовой пояс не найден. Пример: Europe/Moscow.');}patch.timezone=text;}
    else{const [start,end]=text.split(/\s*-\s*/);if(!start||!end||!CLOCK.test(start)||!CLOCK.test(end)||start===end)return this.say(t,'Нужен формат ЧЧ:ММ-ЧЧ:ММ, например 22:00-08:00.');patch.quietHours={enabled:true,start,end};}
    await this.domain.updateReminders(t.ctx,patch,this.key(t,'reminders'));
    delete this.m(t).reminderField;
    return this.reminderView(t);
  }

  // ---------- menu
  private async menuAction(t:Turn,arg:string) {
    switch(arg){
      case 'u':return this.compose(t,{mode:'understand'});
      case 'd':return this.compose(t,{mode:'say_direct'});
      case 'bs':return this.compose(t,{mode:'before_send'});
      case 'th':return this.compose(t,{mode:'thread'});
      case 'ex':return this.examples(t);
      case 'h':return this.history(t,0,null);
      case 'p':return this.say(t,T.progress(await this.domain.progress(t.ctx,{})),[[f('Навыки','m','skills'),f('История','m','h')],[toMenu]]);
      case 'skills':{const [p,a]=await Promise.all([this.domain.progress(t.ctx,{}),this.domain.skillAttempts(t.ctx,{limit:10})]);return this.say(t,`${T.progress(p)}\n\nПоследние оценённые попытки:\n${T.attempts(a.items)}`,[[toMenu]]);}
      case 'pd':{const p=await this.domain.dailyPractice(t.ctx,{});return this.say(t,T.practice(p),[[f('Выполнено','pdone')],[toMenu]]);}
      case 'cards':return this.cardsList(t);
      case 'test':return this.say(t,'Тест до/после: 3–5 коротких заданий. Добровольно, без рейтинга. Повторный тест открывается через 7 дней после входного.',[[f('Входной тест','ts','baseline'),f('Повторный тест','ts','followup')],[toMenu]]);
      case 'rem':return this.reminderView(t);
      case 'web':return this.issueWebLink(t);
      case 'a':return this.accountView(t);
      case 'more':return this.say(t,T.texts.menu,menuRows(1));
      default:return this.menu(t);
    }
  }
  private async nav(t:Turn,arg:string) {
    if(arg==='cancel'){if(!ready(t.account))return this.resumeOnboarding(t);return this.menu(t,T.texts.cancelled);}
    const d=t.dlg.draft;
    if(arg==='skip'&&t.dlg.step==='compose'){const k=nextField(d);if(k==='context'||k==='intent')return this.compose(t,{...d,[k]:''});}
    if(arg==='back'&&t.dlg.step==='compose'&&d.mode){
      const filled=ORDER[d.mode].filter(k=>d[k]!==undefined),last=filled.at(-1);
      if(!last)return this.menu(t);
      const {[last]:_drop,...rest}=d;void _drop;return this.compose(t,rest);
    }
    return this.say(t,T.texts.stale);
  }

  // ---------- composer (all four modes): one short question per step, state in the DB dialogue
  private async compose(t:Turn,d:Draft) {
    await this.go(t,'compose',d,{sessionId:null,previewId:null,roleplayId:null});
    const k=nextField(d),back=[b('Назад','nav','back'),b('Отмена','nav','cancel')],cancel=[b('Отмена','nav','cancel')];
    const first=d.mode?ORDER[d.mode].findIndex(x=>x===k)===0:false;
    if(d.mode==='thread'&&!k){
      const turns=d.turns??[];
      const shown=turns.map((x,n)=>`${n+1}. ${x.speaker==='self'?'Я':'Собеседник'}: ${T.shortTitle(x.text,120)}`).join('\n');
      return this.say(t,`Ветка переписки (до ${T.limits.turns} реплик). Добавляй реплики по порядку.\n\n${shown||'Пока пусто.'}\n\n${T.texts.privacyHint}`,[[b('+ Моя реплика','sp','self'),b('+ Реплика собеседника','sp','other')],...(turns.length?[[b('Удалить последнюю','tdel'),b('Готово','tdone')]]:[]),cancel]);
    }
    if(!k){
      if(d.mode==='understand')return this.toGuess(t,d);
      return this.finishCompose(t,d);
    }
    const direct=d.mode==='say_direct';
    switch(k){
      case 'message':return this.say(t,`Пришли сообщение, которое хочешь понять (до ${T.limits.message} символов). Только текст, который ты сам выбрал.\n\n${T.texts.privacyHint}`,[cancel]);
      case 'draft':return this.say(t,direct?`Какую свою фразу хочешь сказать прямее? (до ${T.limits.draft} символов)\n\nСмысл, эмоция, отказ и границы сохранятся — «нет» не станет «да».`:`Пришли свой черновик, который хочешь проверить до отправки (до ${T.limits.draft} символов). Сообщение собеседника не нужно.\n\n${T.texts.privacyHint}`,[first?cancel:back]);
      case 'intent':return this.say(t,`Что хочешь выразить или чего добиться? Необязательно, до ${T.limits.intent} символов.`,[[b('Пропустить','nav','skip')],back]);
      case 'relationship':return this.say(t,`${d.mode==='understand'||d.mode==='thread'?'Кто тебе этот человек?':'Кому ты это пишешь?'} Например: друг, мама, коллега (до ${T.limits.relationship} символов).`,[first?cancel:back]);
      case 'contextType':return this.say(t,'К какой сфере это относится? От этого зависят примеры и подсказки.',[CONTEXTS.slice(0,2).map(c=>b(T.contextLabels[c],'ct',c)),CONTEXTS.slice(2).map(c=>b(T.contextLabels[c],'ct',c)),back]);
      case 'context':return this.say(t,`Что было до этого? Необязательно, до ${T.limits.context} символов.`,[[b('Пропустить','nav','skip')],back]);
      case 'goal':return this.say(t,'Чего хочешь добиться?',[GOALS.slice(0,2).map(g=>b(T.goalLabels[g],'g',g)),GOALS.slice(2).map(g=>b(T.goalLabels[g],'g',g)),back]);
      default:return this.say(t,T.texts.unknownInput);
    }
  }
  private async composeInput(t:Turn,text:string) {
    const d=t.dlg.draft,m=this.m(t);
    // Reply draft / card attempt inside compose step without a mode.
    if(!d.mode&&t.dlg.sessionId){
      if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
      const s=await this.domain.session(t.ctx,{id:t.dlg.sessionId});
      return this.previewFor(t,{kind:'reply_feedback',sessionId:s.id,expectedRevision:s.revision,draft:text});
    }
    if(!d.mode&&m.cardId){
      if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
      const c=await this.domain.card(t.ctx,{id:m.cardId});
      return this.previewFor(t,{kind:'card_feedback',cardId:c.id,contentVersion:c.contentVersion,answer:text});
    }
    if(!d.mode)return this.say(t,T.texts.unknownInput);
    const k=nextField(d);
    if(d.mode==='thread'&&!k){
      const speaker=m.speaker;
      if(!speaker)return this.say(t,'Сначала выбери, чья это реплика: «+ Моя реплика» или «+ Реплика собеседника».');
      if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
      const turns=d.turns??[];
      if(turns.length>=T.limits.turns)return this.say(t,`Не больше ${T.limits.turns} реплик. Нажми «Готово».`);
      delete m.speaker;
      return this.compose(t,{...d,turns:[...turns,{id:intentKey(t.intent,'turn',turns.length),speaker,text}]});
    }
    const limit:Partial<Record<keyof Draft,number>>={message:T.limits.message,draft:T.limits.draft,intent:T.limits.intent,relationship:T.limits.relationship,context:T.limits.context};
    if(!k||!limit[k])return this.say(t,T.texts.unknownInput);
    if(text.length>limit[k]!)return this.say(t,T.tooLong(limit[k]!,text.length));
    return this.compose(t,{...d,[k]:text});
  }
  private async toGuess(t:Turn,d:Draft) {
    const {guess:_g,...rest}=d;void _g;
    await this.go(t,'guess',rest,{sessionId:null,previewId:null,roleplayId:null});
    return this.say(t,`Сначала твоя версия: что, по-твоему, чувствует собеседник?\n\nНапиши до ${T.limits.emotions} эмоций через запятую — или нажми «Не понимаю». Это нормально.`,[[b('Не понимаю','ns')],[b('Отмена','nav','cancel')]]);
  }
  private async guessInput(t:Turn,text:string) {
    const d=t.dlg.draft;
    if(!d.guess){
      const emotions=text.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
      if(!emotions.length||emotions.length>T.limits.emotions||emotions.some(e=>e.length>T.limits.emotion))return this.say(t,`Нужно до ${T.limits.emotions} эмоций через запятую, каждая до ${T.limits.emotion} символов.`);
      await this.go(t,'guess',{...d,guess:{emotions,quotes:[],unsure:false}});
      return this.say(t,`Какие слова на это указывают? Пришли точную цитату (до ${T.limits.quotes}) или нажми «Готово».`,[[b('Готово','qd')],[b('Отмена','nav','cancel')]]);
    }
    const sources=d.mode==='thread'?(d.turns??[]).map(x=>x.text):[d.message??''];
    if(!sources.some(s=>s.includes(text)))return this.say(t,'Такой цитаты нет в тексте. Скопируй слова точно или нажми «Готово».',[[b('Готово','qd')]]);
    const quotes=[...new Set([...d.guess.quotes,text])].slice(0,T.limits.quotes),next={...d,guess:{...d.guess,quotes}};
    if(quotes.length>=T.limits.quotes)return this.finishCompose(t,next);
    await this.go(t,'guess',next);
    return this.say(t,`Добавлено цитат: ${quotes.length} из ${T.limits.quotes}. Ещё одну или «Готово».`,[[b('Готово','qd')]]);
  }
  /** Compose → SessionInputV2 → createSession → createPreview. No generation here. */
  private async finishCompose(t:Turn,d:Draft) {
    if(!d.mode||!d.relationship||!d.contextType||!d.goal||d.context===undefined)return this.say(t,T.texts.stale,menuRows());
    const base={relationship:d.relationship,context:d.context,contextType:d.contextType,goal:d.goal};
    const title=T.shortTitle(d.title??d.message??d.draft??d.turns?.[0]?.text??T.modeLabels[d.mode],T.limits.title);
    const guess=d.guess??{emotions:[],quotes:[],unsure:true};
    let input:z.infer<typeof SessionInputV2>;
    if(d.mode==='understand'){if(!d.message)return this.say(t,T.texts.stale,menuRows());input={...base,title,mode:'understand',message:d.message,guess};}
    else if(d.mode==='thread'){if(!d.turns?.length)return this.say(t,T.texts.stale,menuRows());input={...base,title,mode:'thread',turns:d.turns,guess};}
    else if(d.mode==='say_direct'){if(!d.draft)return this.say(t,T.texts.stale,menuRows());input={...base,title,mode:'say_direct',draft:d.draft,intent:d.intent??''};}
    else{if(!d.draft)return this.say(t,T.texts.stale,menuRows());input={...base,title,mode:'before_send',draft:d.draft};}
    const session=await this.domain.createSession(t.ctx,input,this.key(t,'create_session'));
    return this.previewFor(t,{kind:sourceKind(d.mode),sessionId:session.id,expectedRevision:session.revision});
  }

  // ---------- preview → edit → confirm → startRun (generation only after explicit confirmation of the exact snapshot)
  private async previewFor(t:Turn,source:Source) {
    const p=await this.domain.createPreview(t.ctx,source,this.key(t,'preview'));
    return this.showPreview(t,p);
  }
  private async showPreview(t:Turn,p:Awaited<ReturnType<ProductFacade['preview']>>) {
    delete this.m(t).editingField;
    if(p.safety==='support'){
      await this.go(t,'menu',{},{sessionId:p.sessionId,previewId:null,roleplayId:null});
      const s=await this.domain.support(t.ctx,{countryCode:'RU'});
      return this.say(t,T.support(s),[[f('Сказать прямо','m','d')],[toMenu]]);
    }
    await this.go(t,'preview',{},{sessionId:p.sessionId,previewId:p.id});
    const editable=p.fields.some(x=>x.editable);
    const rows:Rows=p.budget.fit==='too_large'?[[...(editable?[b('Изменить','edit')]:[]),b('Отмена','nav','cancel')]]:[[b('Отправить в модель','send')],[...(editable?[b('Изменить','edit')]:[]),b('Отмена','nav','cancel')]];
    return this.say(t,T.preview(p),rows);
  }
  private async editMenu(t:Turn) {
    if(!t.dlg.previewId)return this.say(t,T.texts.stale,menuRows());
    const p=await this.domain.preview(t.ctx,{id:t.dlg.previewId});
    const fields=p.fields.filter(x=>x.editable);
    if(!fields.length)return this.say(t,'Здесь нечего редактировать.');
    return this.say(t,'Какое поле исправить?',[...fields.map(x=>[b(T.shortTitle(`${p.fields.indexOf(x)+1}. ${x.label}`,40),'ef',x.id)]),[b('Отмена','nav','cancel')]]);
  }
  private async applyEdit(t:Turn,text:string) {
    const fieldId=this.m(t).editingField!,previewId=t.dlg.previewId;
    if(!previewId)return this.say(t,T.texts.stale,menuRows());
    const current=await this.domain.preview(t.ctx,{id:previewId});
    const p=await this.domain.editPreview(t.ctx,{id:previewId,expectedRevision:current.revision,edits:[{fieldId,value:text}]},this.key(t,'edit_preview'));
    return this.showPreview(t,p);
  }
  private async confirm(t:Turn) {
    const previewId=t.dlg.previewId;
    if(t.dlg.step!=='preview'||!previewId)return this.say(t,T.texts.stale,menuRows());
    const p=await this.domain.preview(t.ctx,{id:previewId});
    const receipt=await this.domain.confirmPreview(t.ctx,{id:p.id,expectedRevision:p.revision,snapshotHash:p.snapshotHash},this.key(t,'confirm'));
    return this.started(t,p.sessionId,this.domain.startRun(t.ctx,{previewId:p.id,previewRevision:receipt.revision,snapshotHash:receipt.snapshotHash,expectedSessionRevision:p.sessionRevision},this.key(t,'start_run')));
  }
  private async started(t:Turn,sessionId:string|null,accepted:Promise<{runId:string;resourceId?:string}>) {
    const a=await accepted;
    let position:number|null=null;
    try{const run=await this.domain.run(t.ctx,{id:a.runId});position=run.status==='pending'?run.queuePosition:null;}catch(error){if(escalates(error))throw error;}
    await this.go(t,'waiting_run',{},{sessionId,previewId:null,roleplayId:a.resourceId??t.dlg.roleplayId});
    return this.say(t,T.queued(position));
  }

  // ---------- learning steps after a result
  private async exerciseAnswer(t:Turn,text:string) {
    const sid=t.dlg.sessionId;if(!sid)return this.say(t,T.texts.stale,menuRows());
    if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
    const s=await this.domain.session(t.ctx,{id:sid});
    const ex=s.runs.items.find(r=>r.kind==='exercise'&&r.status==='succeeded'&&r.revision===s.revision);
    if(!ex)return this.say(t,'Упражнение не найдено — начни его заново.',[[f('Упражнение','xs',sid)]]);
    return this.previewFor(t,{kind:'exercise_feedback',sessionId:sid,expectedRevision:s.revision,exerciseRunId:ex.id,answer:text});
  }
  private async roleplayTurn(t:Turn,text:string) {
    const sid=t.dlg.sessionId,rid=t.dlg.roleplayId;
    if(!sid||!rid)return this.say(t,'Сначала выбери, каким будет собеседник.');
    if(text.length>T.limits.text)return this.say(t,T.tooLong(T.limits.text,text.length));
    const s=await this.domain.session(t.ctx,{id:sid});
    return this.previewFor(t,{kind:'roleplay_turn',roleplayId:rid,expectedRevision:s.revision,content:text});
  }
  private async continueRoleplay(t:Turn,sid:string) {
    const page=await this.domain.roleplays(t.ctx,{sessionId:sid,limit:5});
    const role=page.items.find(r=>r.status==='active'),last=role?.messages.filter(x=>x.role==='assistant').at(-1);
    if(!role||!last)return this.say(t,'Активного разговора нет.',[[f('Начать тренировку','rp',sid),toMenu]]);
    await this.go(t,'roleplay',{},{sessionId:sid,previewId:null,roleplayId:role.id});
    return this.say(t,`Уровень: ${T.difficultyLabels[role.difficulty]}\n\n${T.roleplayMessage(last.content,role.turnCount)}`,role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);
  }
  private async withSession(t:Turn,sid:string,work:(s:Awaited<ReturnType<ProductFacade['session']>>)=>Promise<unknown>) {return work(await this.domain.session(t.ctx,{id:sid}));}
  private async withRun(t:Turn,runId:string,work:(r:Run)=>Promise<unknown>) {return work(await this.domain.run(t.ctx,{id:runId}));}
  private async rate(t:Turn,runId:string,value:'useful'|'not_useful') {
    await this.domain.rateRun(t.ctx,{runId,value},this.key(t,'rate'));
    return this.say(t,`Отмечено: «${value==='useful'?'Полезно':'Не полезно'}». Оценку можно изменить другой кнопкой.`);
  }

  // ---------- examples, practice, cards, assessment
  private async examples(t:Turn) {
    const page=await this.domain.examples(t.ctx,{limit:10});
    if(!page.items.length)return this.say(t,'Каталог примеров пока пуст.',[[toMenu]]);
    return this.say(t,'Выбери вымышленную ситуацию. Разбор сгенерирует настоящая локальная модель — заготовленных ответов нет.',[...page.items.map(e=>[f(`${T.contextLabels[e.input.contextType]} · ${T.shortTitle(e.input.title,30)}`,'exs',e.id)]),[toMenu]]);
  }
  private async pickExample(t:Turn,id:string) {
    const e=await this.domain.example(t.ctx,{id}),i=e.input;
    const base:Draft={mode:i.mode,title:i.title,relationship:i.relationship,context:i.context,contextType:i.contextType,goal:i.goal};
    const shown=i.mode==='understand'?i.message:i.mode==='thread'?i.turns.map(x=>`${x.speaker==='self'?'Я':'Собеседник'}: ${x.text}`).join('\n'):i.draft;
    await this.say(t,`Пример (вымышленный) · ${T.modeLabels[i.mode]} · ${T.contextLabels[i.contextType]}\n\n${shown}\n\nСобеседник: ${i.relationship}${i.context?`\nКонтекст: ${i.context}`:''}\nЦель: ${T.goalLabels[i.goal]}`);
    if(i.mode==='understand')return this.toGuess(t,{...base,message:i.message});
    if(i.mode==='thread')return this.toGuess(t,{...base,turns:i.turns});
    if(i.mode==='say_direct')return this.finishCompose(t,{...base,draft:i.draft,intent:i.intent});
    return this.finishCompose(t,{...base,draft:i.draft});
  }
  private async completePractice(t:Turn) {
    const p=await this.domain.dailyPractice(t.ctx,{});
    await this.domain.completeDailyPractice(t.ctx,{id:p.id,contentVersion:p.contentVersion},this.key(t,'practice'));
    const progress=await this.domain.progress(t.ctx,{});
    return this.say(t,`Отмечено за ${p.localDate}. Серия: ${progress.streak.current}. Повторное нажатие не засчитывается дважды.`,[[toMenu]]);
  }
  private async cardsList(t:Turn) {
    const page=await this.domain.cards(t.ctx,{limit:10});
    if(!page.items.length)return this.say(t,'Карточек пока нет.',[[toMenu]]);
    return this.say(t,'Карточки: короткая теория, пример и практика.',[...page.items.map(c=>[f(`${c.completed?'✓ ':''}${T.skillLabels[c.skill]} · ${T.shortTitle(c.title,30)}`,'co',c.id)]),[toMenu]]);
  }
  private async openCard(t:Turn,id:string) {
    const c=await this.domain.card(t.ctx,{id});
    return this.say(t,T.card(c),[[f('Попробовать','ctry',c.id),...(c.completed?[]:[f('Отметить пройденной','cc',c.id)])],[f('Все карточки','m','cards'),toMenu]]);
  }
  private async completeCard(t:Turn,id:string) {
    const c=await this.domain.card(t.ctx,{id});
    await this.domain.completeCard(t.ctx,{id:c.id,contentVersion:c.contentVersion},this.key(t,'card'));
    return this.say(t,'Карточка отмечена пройденной.',[[f('Все карточки','m','cards'),toMenu]]);
  }
  private async startAssessment(t:Turn,kind:'baseline'|'followup') {
    const form=await this.domain.assessment(t.ctx,{kind});
    if(form.submittedAt){const results=await this.domain.assessmentResults(t.ctx,{limit:5});const r=results.items.find(x=>x.id===form.id)??results.items[0];return this.say(t,r?T.assessmentResult(r):'Тест уже пройден.',[[toMenu]]);}
    this.m(t).assessment={id:form.id,kind,answers:[]};
    await this.go(t,'assessment',{},{sessionId:null,previewId:null,roleplayId:null});
    await this.say(t,T.assessmentIntro(form));
    return this.askTask(t,form,0);
  }
  private askTask(t:Turn,form:Awaited<ReturnType<ProductFacade['assessment']>>,i:number) {
    return this.say(t,T.assessmentTask(form,i),[form.tasks[i]!.choices.map((_,n)=>b(String(n+1),`aa${n}`,String(i))),[b('Отмена','nav','cancel')]]);
  }
  private async answerAssessment(t:Turn,taskIndex:number,choice:number) {
    const state=this.m(t).assessment;
    if(t.dlg.step!=='assessment'||!state)return this.say(t,'Тест прерван (например, бот перезапускался). Начни его заново — ответы ещё не отправлялись.',[[f('Тест до/после','m','test')]]);
    const form=await this.domain.assessment(t.ctx,{kind:state.kind});
    const task=form.tasks[taskIndex],picked=task?.choices[choice];
    if(!task||!picked||taskIndex!==state.answers.length)return this.say(t,T.texts.stale);
    state.answers.push({questionId:task.id,choiceId:picked.id});
    if(state.answers.length<form.tasks.length){await this.go(t,'assessment');return this.askTask(t,form,taskIndex+1);}
    const result=await this.domain.submitAssessment(t.ctx,{id:form.id,contentVersion:form.contentVersion,answers:state.answers},this.key(t,'assessment'));
    delete this.m(t).assessment;
    await this.go(t,'menu',{},{sessionId:null,previewId:null,roleplayId:null});
    return this.say(t,T.assessmentResult(result),[[f('Напоминания','m','rem'),toMenu]]);
  }

  // ---------- history (shared with the web)
  private async history(t:Turn,page:number,filter:Ctx|null) {
    const m=this.m(t);
    if(filter!==(m.historyFilter??null)){m.cursors=[null];m.historyFilter=filter;}
    const known=m.cursors??[null];
    if(page>0&&known[page]===undefined)page=0;
    const cursor=known[page]??undefined;
    const result=await this.domain.sessions(t.ctx,{limit:HISTORY_PAGE,...(cursor?{cursor}:{}),...(filter?{contextType:filter}:{})});
    const next=known.slice(0,page+1);if(result.nextCursor)next[page+1]=result.nextCursor;m.cursors=next;
    const filters=CONTEXTS.map(c=>f(filter===c?`• ${T.contextLabels[c]}`:T.contextLabels[c],'hf',c));
    if(!result.items.length&&page===0)return this.say(t,filter?`В сфере «${T.contextLabels[filter]}» записей нет.`:'Пока нет сохранённых разборов.',[filters.slice(0,2),filters.slice(2),...(filter?[[f('Все сферы','hf','all')]]:[]),[f('Понять сообщение','m','u'),f('Пример','m','ex')],[toMenu]]);
    const n=(i:number)=>page*HISTORY_PAGE+i+1;
    const lines=result.items.map((s,i)=>`${n(i)}. ${T.shortTitle(s.input.title)} · ${T.modeLabels[s.input.mode]} — ${new Date(s.updatedAt).toLocaleDateString('ru-RU',{timeZone:'UTC'})}`);
    const navRow=[...(page>0?[f('← Назад','hn',String(page-1))]:[]),...(result.nextCursor?[f('Дальше →','hn',String(page+1))]:[])];
    return this.say(t,`История${filter?` · ${T.contextLabels[filter]}`:''} · страница ${page+1}\nОбщая для бота и сайта.\n\n${lines.join('\n')}`,[
      ...result.items.map((s,i)=>[f(`${n(i)}. ${T.shortTitle(s.input.title,40)}`,'ho',s.id)]),...(navRow.length?[navRow]:[]),filters.slice(0,2),filters.slice(2),...(filter?[[f('Все сферы','hf','all')]]:[]),[toMenu]]);
  }
  private async openSession(t:Turn,sid:string) {
    const s=await this.domain.session(t.ctx,{id:sid}),i=s.input;
    const main=s.runs.items.find(r=>r.kind===sourceKind(i.mode)&&r.revision===s.revision);
    const role=(await this.domain.roleplays(t.ctx,{sessionId:sid,limit:5})).items.find(r=>r.status==='active');
    const status=!main?'Разбор ещё не запускался.':main.status==='pending'?'Запрос выполняется — результат придёт сюда.':main.status==='failed'?`Не удалось: ${T.runFailure[main.errorCode]??''}`:'Результат готов.';
    const rows:Rows=[];
    if(main?.status==='succeeded'){
      rows.push([f('Показать результат','ha',sid)]);
      if(main.kind==='analysis')rows.push([f('Как уточнить?','cl',main.id),f('Написать ответ','rw',sid)],[f('Упражнение','xs',sid),f(role?'Продолжить разговор':'Потренировать разговор',role?'rc':'rp',sid)]);
    }else if(main?.status==='failed')rows.push([f('Повторить','rt',main.id)]);
    else if(!main)rows.push([f('Подготовить разбор','hr',sid)]);
    rows.push([f('Удалить','hd',sid),f('К истории','m','h')]);
    const body=i.mode==='understand'?`Сообщение: «${i.message}»`:i.mode==='thread'?i.turns.map(x=>`${x.speaker==='self'?'Я':'Собеседник'}: ${x.text}`).join('\n'):`Мой текст: «${i.draft}»`;
    return this.say(t,`${i.title} · ${T.modeLabels[i.mode]}\n${new Date(s.updatedAt).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC\n\n${body}\nСобеседник: ${i.relationship}\nСфера: ${T.contextLabels[i.contextType]}\nЦель: ${T.goalLabels[i.goal]}${i.context?`\nКонтекст: ${i.context}`:''}\n\n${status}`,rows);
  }
  private async showResult(t:Turn,sid:string) {
    const s=await this.domain.session(t.ctx,{id:sid});
    const run=s.runs.items.find(r=>r.kind===sourceKind(s.input.mode)&&r.status==='succeeded'&&r.revision===s.revision);
    if(!run)return this.say(t,'Готового результата нет.',[[f('Подготовить разбор','hr',sid)]]);
    return this.render(t,run,false);
  }

  // ---------- rendering of finished runs (from delivery or history)
  private resultRows(run:Run):Rows {
    const rate=[f('Полезно','up',run.id),f('Не полезно','un',run.id)],sid=run.sessionId;
    switch(run.kind){
      case 'analysis':return sid?[[f('Как уточнить?','cl',run.id)],rate,[f('Написать ответ','rw',sid),f('Упражнение','xs',sid)],[f('Потренировать разговор','rp',sid)],[toMenu]]:[rate,[toMenu]];
      case 'reply_feedback':case 'before_send':{
        const out=run.status==='succeeded'?run.output:null;
        const details=(out?.phrases??[]).slice(0,6).map((_,n)=>[f(`${n+1}: Почему? / Мягче`,`pw${n}`,run.id)]);
        return [...details,rate,...(sid&&run.kind==='reply_feedback'?[[f('Другой черновик','rw',sid)]]:[]),[toMenu]];
      }
      case 'reply_examples':return [rate,...(sid?[[f('Написать свой вариант','rw',sid)]]:[]),[toMenu]];
      case 'exercise_feedback':return [rate,...(sid?[[f('Ещё упражнение','xs',sid)]]:[]),[toMenu]];
      case 'roleplay_feedback':return [rate,...(sid?[[f('Ещё тренировка','rp',sid)]]:[]),[toMenu]];
      default:return [rate,[toMenu]];
    }
  }
  private async render(t:Turn,run:Run,fromDelivery:boolean):Promise<unknown> {
    if(run.status!=='succeeded')return;
    const waiting=fromDelivery&&t.dlg.step==='waiting_run'&&t.dlg.sessionId===run.sessionId;
    const toMenuStep=async()=>{if(waiting)await this.go(t,'menu',{},{sessionId:run.sessionId,previewId:null,roleplayId:null});};
    switch(run.kind){
      case 'analysis':{
        await toMenuStep();
        const p=await this.domain.preview(t.ctx,{id:run.previewId}).catch(error=>{if(escalates(error))throw error;return null;});
        return this.say(t,T.analysis(run.output,new Map(p?.fields.map(x=>[x.id,x.label])??[])),this.resultRows(run));
      }
      case 'reply_feedback':case 'before_send':await toMenuStep();return this.say(t,T.draftFeedback(run.output),this.resultRows(run));
      case 'reply_examples':await toMenuStep();return this.say(t,`Примеры под разные цели:\n\n${T.options(run.output)}`,this.resultRows(run));
      case 'say_direct':await toMenuStep();return this.say(t,T.direct(run.output),[[f('Полезно','up',run.id),f('Не полезно','un',run.id)],[f('Новая фраза','m','d'),toMenu]]);
      case 'clarify':await toMenuStep();return this.say(t,T.clarifyRun(run.output),this.resultRows(run));
      case 'exercise':
        if(waiting){await this.go(t,'exercise',{},{sessionId:run.sessionId,previewId:null,roleplayId:null});return this.say(t,T.exercise(run.output),[[toMenu]]);}
        return this.say(t,T.exercise(run.output),[[f('Ответить на упражнение','xa',run.id)],[toMenu]]);
      case 'exercise_feedback':case 'card_feedback':await toMenuStep();return this.say(t,T.feedback(run.output),this.resultRows(run));
      case 'roleplay_feedback':await toMenuStep();return this.say(t,T.roleplayFeedback(run.output),this.resultRows(run));
      case 'roleplay_start':case 'roleplay_turn':{
        const out=run.output;
        if(out.kind==='feedback'){await toMenuStep();return this.say(t,T.roleplayFeedback(out),this.resultRows({...run,kind:'roleplay_feedback'} as Run));}
        const sid=run.sessionId;
        const role=sid?(await this.domain.roleplays(t.ctx,{sessionId:sid,limit:5})).items.find(r=>r.status==='active'):undefined;
        if(!role||!sid)return this.say(t,`Собеседник:\n${out.content}`,[[toMenu]]);
        if(waiting){await this.go(t,'roleplay',{},{sessionId:sid,previewId:null,roleplayId:role.id});return this.say(t,T.roleplayMessage(out.content,role.turnCount),role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);}
        return this.say(t,`Собеседник:\n${out.content}`,[[f('Продолжить разговор','rc',sid)]]);
      }
    }
  }

  // ---------- outbox delivery (never generates)
  async deliver(t:Turn,delivery:Delivery) {
    if(delivery.kind==='reminder'){
      const n=delivery.notification;
      return this.say(t,`Напоминание о практике дня (${n.localDate}): ${n.title}\n\nЭто необязательно. Отключить напоминания можно в /account → Напоминания.`,[[f('Открыть практику','m','pd')],[f('Настройки напоминаний','m','rem')]]);
    }
    const run=delivery.run;
    if(run.status==='pending')return;
    if(run.status==='failed'){
      if(t.dlg.step==='waiting_run'&&t.dlg.sessionId===run.sessionId)await this.go(t,'menu',{},{sessionId:run.sessionId,previewId:null,roleplayId:null});
      const stale=run.errorCode==='PREVIEW_STALE'||run.errorCode==='INPUT_TOO_LARGE';
      return this.say(t,`${T.runFailure[run.errorCode]??'Не удалось получить ответ модели.'} Сохранённые данные не потеряны.`,[[...(stale?[]:[f('Повторить','rt',run.id)]),...(run.sessionId?[f('Открыть','ho',run.sessionId)]:[])],[toMenu]]);
    }
    return this.render(t,run,true);
  }
}
