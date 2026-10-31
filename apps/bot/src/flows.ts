import type {Api} from 'grammy';
import type {Callback} from './callbacks.js';
import {intentKey} from './callbacks.js';
import {type Account,type AnalysisOutput,type BotDomain,type BotRun,type ContextType,type Delivery,type DialogState,type Difficulty,type DraftFields,type GoalValue,type ReplyFeedbackOutput,type UserContext,DomainError,isDomainError} from './domain.js';
import * as T from './text.js';
import {type Rows,b,f,menuRows,send,toMenu} from './ui.js';

export interface Turn {api:Api;user:UserContext;chat:string;account:Account;st:DialogState}
type P=Record<string,unknown>;

const GOALS:GoalValue[]=['support','clarify','reconcile','boundary'];
const CONTEXTS:ContextType[]=['close','colleague','teacher','client'];
const LEVELS:Difficulty[]=['calm','hurt','irritated'];
const HISTORY_PAGE=5;
const EMAIL=/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const verified=(a:Account)=>a.status==='verified'&&a.onboardingCompleted;
const draft=(st:DialogState)=>(st.payload.d??{kind:'understand'}) as DraftFields;
const str=(v:unknown)=>typeof v==='string'?v:'';
const num=(v:unknown)=>typeof v==='number'?v:0;
const maskEmail=(e:string)=>e.replace(/^(.).*(@.*)$/,'$1***$2');

/** Understand-message steps in order; «Назад» walks this list. */
const U_STEPS=['u.msg','u.rel','u.ctxType','u.ctx','u.goal','u.guess','u.quotes'] as const;
const D_STEPS=['d.phrase','d.intent','d.ctx','d.goal','d.attempt'] as const;
/** Ops allowed before email verification and onboarding. */
const OPEN_OPS=new Set(['ok','rs','ce','nav','ac','ay','help']);

export class Flows {
  constructor(private domain:BotDomain) {}

  // ---------- helpers
  private say(t:Turn,text:string,rows:Rows=[]) {return send(t.api,t.chat,text,rows,t.st.version);}
  private async go(t:Turn,name:string,payload:P={}) {t.st=await this.domain.setState(t.user,name,payload,t.st.version);return t.st;}
  async menu(t:Turn,prefix?:string) {await this.go(t,'idle');await this.say(t,prefix?`${prefix}\n\n${T.texts.menu}`:T.texts.menu,menuRows());}

  async explain(t:Turn,error:unknown) {
    if(!(error instanceof DomainError)){await this.domain.track(t.user,'technical_error').catch(()=>{});return this.say(t,T.texts.internal,[[toMenu]]);}
    switch(error.code){
      case 'STATE_CONFLICT':return this.say(t,T.texts.stale,menuRows());
      case 'PREVIEW_STALE':return this.say(t,'Предпросмотр устарел: данные изменились. Проверь новый предпросмотр.',[[toMenu]]);
      case 'NOT_FOUND':return this.say(t,T.texts.notFound,[[toMenu]]);
      case 'OPERATION_IN_PROGRESS':return this.say(t,T.texts.busy);
      case 'RATE_LIMITED':return this.say(t,error.retryAfterSeconds?`${T.texts.rateLimited} Можно через ${error.retryAfterSeconds} с.`:T.texts.rateLimited,[[toMenu]]);
      case 'MODEL_UNAVAILABLE':case 'DEPENDENCY_UNAVAILABLE':return this.say(t,T.texts.modelDown,[[toMenu]]);
      case 'REVISION_CONFLICT':return this.say(t,T.texts.conflict,[[f('История','m','h'),toMenu]]);
      case 'EMAIL_NOT_VERIFIED':case 'UNAUTHORIZED':return this.say(t,T.texts.needVerify);
      case 'VALIDATION_ERROR':case 'EMAIL_INVALID':return this.say(t,error.message&&error.message!==error.code?error.message:'Проверь введённые данные и попробуй ещё раз. Черновик сохранён.');
      default:await this.domain.track(t.user,'technical_error').catch(()=>{});return this.say(t,T.texts.internal,[[toMenu]]);
    }
  }

  // ---------- entry points
  async command(t:Turn,cmd:string) {
    if(cmd==='start')return this.start(t);
    if(cmd==='help')return this.say(t,T.texts.help,verified(t.account)?[[toMenu]]:[]);
    if(cmd==='cancel'){
      const waiting=t.st.name==='wait';
      if(t.st.name!=='idle')await this.domain.track(t.user,'flow_cancelled');
      if(!verified(t.account))return this.resumeOnboarding(t);
      return this.menu(t,waiting?'Уже запущенный запрос не отменяется — результат придёт сюда.':T.texts.cancelled);
    }
    if(cmd==='account')return this.accountView(t);
    if(!verified(t.account))return this.resumeOnboarding(t);
    if(cmd==='menu')return this.menu(t);
    if(cmd==='history')return this.history(t,0,[],null);
    return this.say(t,'Не знаю такой команды. '+T.texts.help);
  }

  async text(t:Turn,raw:string) {
    const text=raw.trim(),name=t.st.name;
    if(name==='onb.email'||name==='acc.email')return this.emailInput(t,text);
    if(name==='onb.code'||name==='acc.code')return this.codeInput(t,text);
    if(!verified(t.account))return this.resumeOnboarding(t);
    if(name.startsWith('u.'))return this.understandInput(t,text);
    if(name.startsWith('d.'))return this.directInput(t,text);
    if(name==='r.draft')return this.textToPreview(t,{kind:'reply',text},T.limits.text);
    if(name==='x.answer')return this.textToPreview(t,{kind:'exercise_answer',text},T.limits.text);
    if(name==='rp.turn')return this.textToPreview(t,{kind:'roleplay_turn',text},T.limits.text);
    if(name==='wait')return this.say(t,T.texts.busy+' /menu — главное меню.');
    if(name==='idle'||name==='h'||name==='pick'){
      if(text.length>T.limits.message)return this.say(t,T.tooLong(T.limits.message,text.length));
      await this.go(t,'pick',{text});
      return this.say(t,'Что сделать с этим текстом?',[[b('Понять сообщение','pick','u'),b('Сказать прямо','pick','d')],[toMenu]]);
    }
    return this.say(t,T.texts.unknownInput);
  }

  async callback(t:Turn,cb:Callback|null) {
    if(!cb)return this.say(t,T.texts.stale,verified(t.account)?menuRows():[]);
    if(cb.version!==null&&cb.version!==t.st.version)return this.say(t,T.texts.stale,verified(t.account)?menuRows():[]);
    if(!verified(t.account)&&!OPEN_OPS.has(cb.op))return this.resumeOnboarding(t);
    if(cb.op==='nav')return this.nav(t,cb.arg);
    const handler=this.ops[cb.op.replace(/\d+$/,'')];
    if(!handler)return this.say(t,T.texts.stale,menuRows());
    return handler(t,cb.arg,Number(cb.op.match(/\d+$/)?.[0]??0));
  }

  private ops:Record<string,(t:Turn,arg:string,n:number)=>Promise<unknown>>={
    // onboarding / account
    ok:t=>this.afterIntro(t),
    rs:t=>this.resend(t),
    ce:t=>this.go(t,t.account.status==='verified'?'acc.email':'onb.email').then(()=>this.say(t,T.texts.askEmail,[[b('Отмена','nav','cancel')]])),
    ac:(t,arg)=>this.accountAction(t,arg),
    ay:(t,arg)=>this.accountConfirm(t,arg),
    help:t=>this.say(t,T.texts.help),
    // menu
    m:(t,arg)=>this.menuAction(t,arg),
    pick:(t,arg)=>{const text=str(t.st.payload.text);return arg==='d'?this.directStep(t,'d.intent',{d:{kind:'direct',text}}):this.understandStep(t,'u.rel',{d:{kind:'understand',message:text}});},
    exs:(t,arg)=>this.pickExample(t,arg),
    // understand / direct steps
    ct:(t,arg)=>this.setField(t,{contextType:CONTEXTS.includes(arg as ContextType)?arg as ContextType:undefined}),
    g:(t,arg)=>GOALS.includes(arg as GoalValue)?this.setField(t,{goal:arg as GoalValue}):this.say(t,T.texts.stale),
    ns:t=>this.setField(t,{guess:{emotions:[],evidenceQuotes:[],unsure:true}},true),
    qd:t=>this.showPreview(t),
    da:t=>this.setField(t,{attempt:null},true),
    pv:(t,arg)=>arg==='send'?this.confirmPreview(t):this.editPreview(t),
    ef:(t,arg)=>this.editField(t,arg),
    // results
    rw:(t,sid)=>this.withSession(t,sid,s=>this.go(t,'r.draft',{c:{sid,rev:s.revision}}).then(()=>this.say(t,'Напиши свой черновик ответа (до 3000 символов). Сначала свой вариант — так полезнее.\n\nЕсли не знаешь, с чего начать, нажми «Нужен пример».',[[b('Нужен пример','rx',sid)],[toMenu]]))),
    rx:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,'reply_examples',key=>this.domain.replyExamples(t.user,sid,s.revision,key),'rx')),
    xs:(t,sid)=>this.withSession(t,sid,s=>this.domain.track(t.user,'exercise_started').then(()=>this.submit(t,sid,'exercise',key=>this.domain.exercise(t.user,sid,s.revision,key),'xs'))),
    xa:(t,runId)=>this.exerciseAnswer(t,runId),
    rp:(t,sid)=>this.withSession(t,sid,s=>this.go(t,'rp.level',{sid,rev:s.revision}).then(()=>this.say(t,'Каким будет собеседник? Реакции будут зависеть и от уровня, и от твоих ответов. Будет три твоих ответа, закончить можно раньше.',[LEVELS.map(l=>b(T.difficultyLabels[l],'lv',l)),[toMenu]]))),
    lv:(t,arg)=>{const sid=str(t.st.payload.sid);if(!LEVELS.includes(arg as Difficulty))return this.say(t,T.texts.stale);
      return this.domain.track(t.user,'roleplay_started').then(()=>this.submit(t,sid,'roleplay_start',key=>this.domain.roleplayStart(t.user,sid,num(t.st.payload.rev),arg as Difficulty,key),'lv',arg));},
    fin:t=>{const c=t.st.payload.c as P|undefined;if(!c)return this.say(t,T.texts.stale,menuRows());
      return this.submit(t,str(c.sid),'roleplay_feedback',key=>this.domain.roleplayFinish(t.user,str(c.rid),num(c.rev),key),'fin',str(c.rid));},
    rc:(t,sid)=>this.continueRoleplay(t,sid),
    cl:(t,runId)=>this.withRun(t,runId,run=>run.kind==='analysis'&&run.status==='succeeded'?this.say(t,T.clarify(run.output as AnalysisOutput),[[toMenu]]):this.say(t,T.texts.notFound)),
    pw:(t,runId,n)=>this.withRun(t,runId,run=>run.kind==='reply_feedback'&&run.status==='succeeded'?this.say(t,T.phraseWhy(run.output as ReplyFeedbackOutput,n)??T.texts.notFound):this.say(t,T.texts.notFound)),
    ps:(t,runId,n)=>this.withRun(t,runId,run=>run.kind==='reply_feedback'&&run.status==='succeeded'?this.say(t,T.phraseSofter(run.output as ReplyFeedbackOutput,n)??T.texts.notFound):this.say(t,T.texts.notFound)),
    up:(t,runId)=>this.rate(t,runId,'useful'),
    un:(t,runId)=>this.rate(t,runId,'not_useful'),
    rt:(t,runId)=>this.withRun(t,runId,run=>run.status!=='failed'?this.say(t,T.texts.stale,menuRows()):this.submit(t,run.sessionId,run.kind,key=>this.domain.retry(t.user,runId,run.revision,key),'rt',runId)),
    dr:t=>this.directStep(t,'d.phrase',{d:{kind:'direct'}}),
    dre:t=>t.st.name==='d.done'?this.directStep(t,'d.goal',{d:{...draft(t.st),attempt:null},ret:'pv'}):this.say(t,T.texts.stale,menuRows()),
    // history
    hn:t=>this.historyMove(t,1),
    hp:t=>this.historyMove(t,-1),
    hf:(t,arg)=>this.history(t,0,[],CONTEXTS.includes(arg as ContextType)?arg as ContextType:null),
    ho:(t,sid)=>this.openSession(t,sid),
    ha:(t,sid)=>this.showAnalysis(t,sid),
    hr:(t,sid)=>this.withSession(t,sid,s=>this.submit(t,sid,'analysis',key=>this.domain.analyze(t.user,sid,s.revision,key),'hr')),
    hd:(t,sid)=>this.withSession(t,sid,s=>this.go(t,'hdel',{sid}).then(()=>this.say(t,`Удалить «${T.shortTitle(s.title)}»?\n\nИз приложения удалятся ситуация, разборы и практика по ней. Сообщения в этом чате Telegram останутся — их можно удалить только в самом Telegram.`,[[b('Да, удалить','hy',sid),f('Нет','ho',sid)]]))),
    hy:async(t,sid)=>{if(str(t.st.payload.sid)!==sid)return this.say(t,T.texts.stale,menuRows());await this.domain.deleteSession(t.user,sid);await this.say(t,'Удалено из приложения.');return this.history(t,0,[],null);}
  };

  // ---------- onboarding and email
  private async start(t:Turn) {
    t.account=await this.domain.startAccount(t.user);
    if(verified(t.account))return this.menu(t,'С возвращением!');
    await this.say(t,T.texts.greeting);
    return this.resumeOnboarding(t);
  }
  private async resumeOnboarding(t:Turn) {
    if(!t.account.onboardingCompleted){await this.go(t,'onb.intro');return this.say(t,T.texts.onboarding,[[b('Понятно, продолжить','ok')],[f('Справка','help')]]);}
    if(t.account.status!=='verified'&&t.account.pendingEmail){
      await this.go(t,'onb.code');
      return this.say(t,`Введи код из письма на ${maskEmail(t.account.pendingEmail)}. Код действует 10 минут.`,[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')],[f('Удалить аккаунт','ac','del')]]);
    }
    await this.go(t,'onb.email');
    return this.say(t,T.texts.askEmail,[[f('Удалить аккаунт','ac','del')]]);
  }
  private async afterIntro(t:Turn) {t.account=await this.domain.completeOnboarding(t.user);return verified(t.account)?this.menu(t):this.resumeOnboarding(t);}
  private async emailInput(t:Turn,email:string) {
    if(email.length>T.limits.email||!EMAIL.test(email))return this.say(t,'Это не похоже на адрес почты. Пример: name@example.com');
    try{t.account=await this.domain.requestEmailCode(t.user,email);}
    catch(error){return this.explain(t,error);}
    await this.go(t,t.st.name==='acc.email'?'acc.code':'onb.code');
    return this.say(t,`Отправил код на ${maskEmail(email)}. Введи его сюда. Код действует 10 минут.`,[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
  }
  private async resend(t:Turn) {
    try{t.account=await this.domain.resendEmailCode(t.user);}
    catch(error){return this.explain(t,error);}
    if(!t.st.name.endsWith('.code'))await this.go(t,t.account.status==='verified'?'acc.code':'onb.code');
    return this.say(t,'Новый код отправлен, старый больше не действует.');
  }
  private async codeInput(t:Turn,code:string) {
    if(!/^\d{4,8}$/.test(code))return this.say(t,'Код — это цифры из письма. Введи их одним сообщением.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
    const result=await this.domain.verifyEmailCode(t.user,code);
    if(result.status==='verified'){t.account=await this.domain.account(t.user);return this.menu(t,'Почта подтверждена.');}
    if(result.status==='invalid')return this.say(t,`Код не подошёл. Осталось попыток: ${result.attemptsLeft}.`,[[f('Отправить код ещё раз','rs')]]);
    if(result.status==='expired')return this.say(t,'Срок кода истёк. Запроси новый.',[[f('Отправить код ещё раз','rs'),f('Сменить почту','ce')]]);
    return this.say(t,'Слишком много неверных попыток. Запроси новый код.',[[f('Отправить код ещё раз','rs')]]);
  }

  // ---------- account
  async accountView(t:Turn) {
    const a=t.account=await this.domain.account(t.user);
    const status=a.status==='verified'?`Почта: ${a.email?maskEmail(a.email):'—'} (подтверждена)`:`Почта не подтверждена${a.pendingEmail?`: ${maskEmail(a.pendingEmail)}`:''}`;
    const change=a.pendingEmail&&a.status==='verified'?`\nОжидает подтверждения новый адрес: ${maskEmail(a.pendingEmail)}`:'';
    const rows:Rows=a.status==='verified'?[[f('Сменить почту','ac','email')],[f('Удалить учебные данные','ac','data')],[f('Удалить аккаунт','ac','del')],[toMenu]]:[[f('Сменить почту','ce')],[f('Удалить аккаунт','ac','del')]];
    return this.say(t,`Аккаунт\n\n${status}${change}\nВход — по твоему Telegram-аккаунту, пароль не нужен.`,rows);
  }
  private async accountAction(t:Turn,arg:string) {
    if(arg==='email'){await this.go(t,'acc.email');return this.say(t,'Напиши новый адрес. История останется в этом Telegram-аккаунте; новый адрес нужно подтвердить кодом.',[[b('Отмена','nav','cancel')]]);}
    if(arg==='data'){await this.go(t,'acc.confirm',{what:'data'});
      return this.say(t,'Удалить учебные данные?\n\nУдалятся все ситуации, разборы, ответы, упражнения, диалоги и прогресс в приложении. Аккаунт и почта останутся.\n\nСообщения в этом чате Telegram это не удалит — их можно удалить только в самом Telegram. Резервные копии сервера очищаются по их сроку хранения, не мгновенно.',[[b('Да, удалить учебные данные','ay','data')],[b('Отмена','nav','cancel')]]);}
    if(arg==='del'){await this.go(t,'acc.confirm',{what:'del'});
      return this.say(t,'Удалить аккаунт?\n\nУдалятся аккаунт, почта, коды подтверждения и все учебные данные приложения. Начать заново можно командой /start.\n\nСообщения в этом чате Telegram останутся — их можно удалить только в самом Telegram. Резервные копии сервера очищаются по их сроку хранения.',[[b('Да, удалить аккаунт','ay','del')],[b('Отмена','nav','cancel')]]);}
    return this.say(t,T.texts.stale);
  }
  private async accountConfirm(t:Turn,arg:string) {
    if(t.st.name!=='acc.confirm'||t.st.payload.what!==arg)return this.say(t,T.texts.stale);
    if(arg==='data'){await this.domain.deleteLearningData(t.user);return this.menu(t,'Учебные данные удалены. Аккаунт сохранён.');}
    await this.domain.deleteAccount(t.user);
    return send(t.api,t.chat,'Аккаунт и данные приложения удалены. Чтобы начать заново, отправь /start.');
  }

  // ---------- menu
  private async menuAction(t:Turn,arg:string) {
    switch(arg){
      case 'u':await this.domain.track(t.user,'understand_started');return this.understandStep(t,'u.msg',{d:{kind:'understand'}});
      case 'd':await this.domain.track(t.user,'direct_started');return this.directStep(t,'d.phrase',{d:{kind:'direct'}});
      case 'ex':return this.examples(t);
      case 'h':return this.history(t,0,[],null);
      case 'p':{const p=await this.domain.progress(t.user);await this.go(t,'idle');return this.say(t,T.progress(p),[[f('История','m','h'),toMenu]]);}
      case 'a':return this.accountView(t);
      default:return this.menu(t);
    }
  }
  private async examples(t:Turn) {
    const list=(await this.domain.examples()).slice(0,10);
    await this.go(t,'idle');
    if(!list.length)return this.say(t,'Каталог примеров пока пуст.',[[toMenu]]);
    return this.say(t,'Выбери вымышленную ситуацию. Разбор сгенерирует настоящая локальная модель — заготовленных ответов нет.',[...list.map(e=>[f(T.shortTitle(e.title,40),'exs',e.id)]),[toMenu]]);
  }
  private async pickExample(t:Turn,id:string) {
    const e=(await this.domain.examples()).find(x=>x.id===id);
    if(!e)return this.say(t,T.texts.notFound,[[toMenu]]);
    await this.domain.track(t.user,'example_selected');
    await this.say(t,`Пример (вымышленный)\n\nСообщение: «${e.message}»\nСобеседник: ${e.relationship}\nСфера: ${T.contextLabels[e.contextType]}${e.context?`\nКонтекст: ${e.context}`:''}`);
    return this.understandStep(t,'u.goal',{d:{kind:'understand',message:e.message,relationship:e.relationship,context:e.context,contextType:e.contextType,sourceExampleId:e.id}});
  }

  // ---------- understand
  private async understandStep(t:Turn,name:typeof U_STEPS[number],payload:P) {
    await this.go(t,name,payload);
    const back=name==='u.msg'?[b('Отмена','nav','cancel')]:[b('Назад','nav','back'),b('Отмена','nav','cancel')];
    const d=payload.d as DraftFields;
    switch(name){
      case 'u.msg':return this.say(t,`Пришли сообщение, которое хочешь понять (до ${T.limits.message} символов). Только текст, который ты сам выбрал.\n\n${T.texts.privacyHint}`,[back]);
      case 'u.rel':return this.say(t,`Кто тебе этот человек? Например: друг, мама, коллега (до ${T.limits.relationship} символов).`,[back]);
      case 'u.ctxType':return this.say(t,'К какой сфере это относится?',[CONTEXTS.slice(0,2).map(c=>b(T.contextLabels[c],'ct',c)),CONTEXTS.slice(2).map(c=>b(T.contextLabels[c],'ct',c)),[b('Пропустить','nav','skip')],back]);
      case 'u.ctx':return this.say(t,`Что было до этого сообщения? Необязательно, до ${T.limits.context} символов.`,[[b('Пропустить','nav','skip')],back]);
      case 'u.goal':return this.say(t,'Чего хочешь добиться ответом?',[GOALS.slice(0,2).map(g=>b(T.goalLabels[g],'g',g)),GOALS.slice(2).map(g=>b(T.goalLabels[g],'g',g)),back]);
      case 'u.guess':return this.say(t,`Сначала твоя версия: что, по-твоему, чувствует собеседник?\n\nНапиши до ${T.limits.emotions} эмоций через запятую — или нажми «Не понимаю». Это нормально.`,[[b('Не понимаю','ns')],back]);
      case 'u.quotes':{const n=d.guess?.evidenceQuotes.length??0;
        return this.say(t,`Какие слова в сообщении на это указывают? Пришли точную цитату из сообщения${n?` (добавлено ${n} из ${T.limits.quotes})`:` (до ${T.limits.quotes})`} или нажми «Готово».`,[[b('Готово','qd')],back]);}
    }
  }
  private nextU(name:string){const i=U_STEPS.indexOf(name as typeof U_STEPS[number]);return U_STEPS[i+1];}
  private async understandInput(t:Turn,text:string) {
    const d={...draft(t.st)},ret=t.st.payload.ret==='pv',name=t.st.name;
    const limit={'u.msg':T.limits.message,'u.rel':T.limits.relationship,'u.ctx':T.limits.context,'u.guess':T.limits.emotion*T.limits.emotions,'u.quotes':T.limits.message}[name];
    if(!limit)return this.say(t,T.texts.unknownInput);
    if(text.length>limit)return this.say(t,T.tooLong(limit,text.length));
    if(name==='u.msg')d.message=text;
    else if(name==='u.rel')d.relationship=text;
    else if(name==='u.ctx')d.context=text;
    else if(name==='u.guess'){
      const emotions=text.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
      if(emotions.length>T.limits.emotions||emotions.some(e=>e.length>T.limits.emotion))return this.say(t,`Нужно до ${T.limits.emotions} эмоций через запятую, каждая до ${T.limits.emotion} символов.`);
      d.guess={emotions,evidenceQuotes:[],unsure:false};
    } else {
      if(!d.message?.includes(text))return this.say(t,'Такой цитаты нет в сообщении. Скопируй слова точно, как в тексте, или нажми «Готово».',[[b('Готово','qd')]]);
      const guess=d.guess??{emotions:[],evidenceQuotes:[],unsure:false};
      if(!guess.evidenceQuotes.includes(text))d.guess={...guess,evidenceQuotes:[...guess.evidenceQuotes,text]};
      if(d.guess!.evidenceQuotes.length>=T.limits.quotes){t.st.payload={...t.st.payload,d};return this.showPreview(t);}
      return this.understandStep(t,'u.quotes',{d,...(ret?{ret:'pv'}:{})});
    }
    if(ret&&name!=='u.guess'){t.st.payload={d};return this.showPreview(t);}
    return this.understandStep(t,this.nextU(name)!,{d,...(ret?{ret:'pv'}:{})});
  }
  private async setField(t:Turn,patch:Partial<DraftFields>,toPreview=false) {
    const d={...draft(t.st),...patch},name=t.st.name;
    if(toPreview||t.st.payload.ret==='pv'){t.st.payload={...t.st.payload,d};return this.showPreview(t);}
    if(name.startsWith('d.'))return this.directStep(t,D_STEPS[D_STEPS.indexOf(name as typeof D_STEPS[number])+1]!,{d});
    return this.understandStep(t,this.nextU(name)!,{d});
  }
  private async nav(t:Turn,arg:string) {
    const name=t.st.name,d=draft(t.st);
    if(arg==='cancel'){
      const back=t.st.payload.back as {name:string;payload:P}|undefined;
      if(name==='pv'&&back){await this.go(t,back.name,back.payload);return this.say(t,'Предпросмотр отменён, в модель ничего не отправлено. Напиши текст заново.',[[toMenu]]);}
      await this.domain.track(t.user,'flow_cancelled');
      if(!verified(t.account))return this.resumeOnboarding(t);
      return this.menu(t,T.texts.cancelled);
    }
    if(arg==='skip'){
      if(name==='u.ctxType')return this.setField(t,{contextType:undefined});
      if(name==='u.ctx'||name==='d.ctx'){const patched={...d,context:''};
        if(t.st.payload.ret==='pv'){t.st.payload={d:patched};return this.showPreview(t);}
        return name==='u.ctx'?this.understandStep(t,'u.goal',{d:patched}):this.directStep(t,'d.goal',{d:patched});}
      return this.say(t,T.texts.stale);
    }
    if(arg==='back'){
      const ui=U_STEPS.indexOf(name as typeof U_STEPS[number]),di=D_STEPS.indexOf(name as typeof D_STEPS[number]);
      if(ui>0)return this.understandStep(t,U_STEPS[ui-1]!,{d});
      if(di>0)return this.directStep(t,D_STEPS[di-1]!,{d});
      return this.menu(t);
    }
    return this.say(t,T.texts.stale);
  }

  // ---------- direct («Сказать прямо»)
  private async directStep(t:Turn,name:typeof D_STEPS[number],payload:P) {
    await this.go(t,name,payload);
    const back=name==='d.phrase'?[b('Отмена','nav','cancel')]:[b('Назад','nav','back'),b('Отмена','nav','cancel')];
    switch(name){
      case 'd.phrase':return this.say(t,`Какую свою фразу хочешь сказать прямее и яснее? (до ${T.limits.text} символов)\n\nСмысл, отказ и границы сохранятся — это не превращение «нет» в «да».`,[back]);
      case 'd.intent':return this.say(t,`Что хочется выразить или чего добиться? (до ${T.limits.text} символов)`,[back]);
      case 'd.ctx':return this.say(t,`Контекст: кому и в какой ситуации? Необязательно, до ${T.limits.context} символов.`,[[b('Пропустить','nav','skip')],back]);
      case 'd.goal':return this.say(t,'Какая цель у фразы?',[GOALS.slice(0,2).map(g=>b(T.goalLabels[g],'g',g)),GOALS.slice(2).map(g=>b(T.goalLabels[g],'g',g)),back]);
      case 'd.attempt':return this.say(t,'Сначала попробуй сам: как бы ты сказал это прямее? Напиши свой вариант — или нажми «Сразу варианты».',[[b('Сразу варианты','da')],back]);
    }
  }
  private async directInput(t:Turn,text:string) {
    const d={...draft(t.st)},name=t.st.name;
    const limit=name==='d.ctx'?T.limits.context:T.limits.text;
    if(name==='d.goal')return this.say(t,T.texts.unknownInput);
    if(text.length>limit)return this.say(t,T.tooLong(limit,text.length));
    if(name==='d.phrase')d.text=text;else if(name==='d.intent')d.intent=text;else if(name==='d.ctx')d.context=text;else d.attempt=text;
    if(name==='d.attempt'||t.st.payload.ret==='pv'){t.st.payload={...t.st.payload,d};return this.showPreview(t);}
    return this.directStep(t,D_STEPS[D_STEPS.indexOf(name as typeof D_STEPS[number])+1]!,{d});
  }

  // ---------- preview → confirm
  private async textToPreview(t:Turn,d:DraftFields,limit:number) {
    if(!d.text)return this.say(t,T.texts.unknownInput);
    if(d.text.length>limit)return this.say(t,T.tooLong(limit,d.text.length));
    t.st.payload={...t.st.payload,d,back:{name:t.st.name,payload:t.st.payload}};
    return this.showPreview(t);
  }
  private async showPreview(t:Turn) {
    const d=draft(t.st),c=t.st.payload.c,back=t.st.payload.back;
    let p;
    try{p=await this.domain.preview(t.user,d);}catch(error){return this.explain(t,error);}
    if(p.safety==='danger'){await this.go(t,'idle');return this.say(t,T.danger,[[f('Сказать прямо','m','d')],[toMenu]]);}
    await this.go(t,'pv',{d,p:{id:p.id,revision:p.revision},...(c?{c}:{}),...(back?{back}:{})});
    return this.say(t,T.preview(p),[[b('Отправить в модель','pv','send')],[b('Редактировать','pv','edit'),b('Отмена','nav','cancel')]]);
  }
  private async editPreview(t:Turn) {
    const d=draft(t.st);
    if(d.kind==='understand'){await this.go(t,'pv.edit',{d});
      return this.say(t,'Что исправить? После правки будет новый предпросмотр.',[[b('Сообщение','ef','msg'),b('Собеседник','ef','rel')],[b('Сфера','ef','ctxType'),b('Контекст','ef','ctx')],[b('Цель','ef','goal'),b('Моя версия','ef','guess')],[b('Отмена','nav','cancel')]]);}
    if(d.kind==='direct'){await this.go(t,'pv.edit',{d});
      return this.say(t,'Что исправить?',[[b('Фраза','ef','phrase'),b('Что выразить','ef','intent')],[b('Контекст','ef','dctx'),b('Цель','ef','dgoal')],[b('Моя формулировка','ef','attempt')],[b('Отмена','nav','cancel')]]);}
    const back=t.st.payload.back as {name:string;payload:P}|undefined;
    if(!back)return this.menu(t);
    await this.go(t,back.name,back.payload);
    return this.say(t,'Напиши исправленный текст одним сообщением. Старый предпросмотр отменён.');
  }
  private async editField(t:Turn,field:string) {
    const d=draft(t.st),ret={d,ret:'pv'};
    const u:Record<string,typeof U_STEPS[number]>={msg:'u.msg',rel:'u.rel',ctxType:'u.ctxType',ctx:'u.ctx',goal:'u.goal',guess:'u.guess'};
    const dm:Record<string,typeof D_STEPS[number]>={phrase:'d.phrase',intent:'d.intent',dctx:'d.ctx',dgoal:'d.goal',attempt:'d.attempt'};
    if(u[field]){
      // A changed message invalidates quotes; a new guess re-asks quotes.
      if(field==='msg'&&d.guess)ret.d={...d,guess:{...d.guess,evidenceQuotes:[]}};
      return this.understandStep(t,u[field],field==='guess'?{d}:ret);
    }
    if(dm[field])return this.directStep(t,dm[field],ret);
    return this.say(t,T.texts.stale);
  }
  private async confirmPreview(t:Turn) {
    const d=draft(t.st),p=t.st.payload.p as {id:string;revision:number}|undefined,c=(t.st.payload.c??{}) as P;
    if(!p)return this.say(t,T.texts.stale,menuRows());
    const k=(s:string)=>intentKey(t.user.telegramId,'pv',p.id,p.revision,s);
    try{
      if(d.kind==='understand'){
        await this.domain.track(t.user,'understand_confirmed');
        const session=await this.domain.createSession(t.user,p.id,p.revision,null,k('create'));
        return this.accepted(t,session.id,'analysis',await this.domain.analyze(t.user,session.id,session.revision,k('analyze')));
      }
      if(d.kind==='direct'){await this.domain.track(t.user,'direct_confirmed');const a=await this.domain.direct(t.user,p.id,p.revision,k('direct'));return this.accepted(t,a.resourceId??'','direct',a,{d});}
      const sid=str(c.sid),rev=num(c.rev);
      if(d.kind==='reply'){await this.domain.track(t.user,'reply_started');return this.accepted(t,sid,'reply_feedback',await this.domain.replyFeedback(t.user,sid,rev,p.id,p.revision,k('reply')));}
      if(d.kind==='exercise_answer')return this.accepted(t,sid,'exercise_feedback',await this.domain.exerciseFeedback(t.user,sid,rev,str(c.exRun),p.id,p.revision,k('exercise')));
      return this.accepted(t,sid,'roleplay_turn',await this.domain.roleplayTurn(t.user,str(c.rid),rev,p.id,p.revision,k('turn')),c);
    }catch(error){
      // Session may already exist (model down after save): a retry from history uses the same confirmed snapshot.
      return this.explain(t,error);
    }
  }

  // ---------- runs
  private async submit(t:Turn,sid:string,kind:string,call:(key:string)=>Promise<import('./domain.js').Accepted>,op:string,arg='') {
    try{return await this.accepted(t,sid,kind,await call(intentKey(t.user.telegramId,t.st.version,op,sid,arg)),t.st.payload.c as P|undefined);}
    catch(error){return this.explain(t,error);}
  }
  private async accepted(t:Turn,sid:string,kind:string,a:import('./domain.js').Accepted,c?:P) {
    await this.go(t,'wait',{sid,kind,runId:a.runId,...(c?{c}:{})});
    return this.say(t,T.queued(a.queuePosition));
  }
  private async withSession(t:Turn,sid:string,work:(s:Awaited<ReturnType<BotDomain['session']>>)=>Promise<unknown>) {
    try{return await work(await this.domain.session(t.user,sid));}catch(error){return this.explain(t,error);}
  }
  private async withRun(t:Turn,runId:string,work:(r:BotRun)=>Promise<unknown>) {
    try{return await work(await this.domain.run(t.user,runId));}catch(error){return this.explain(t,error);}
  }
  private async rate(t:Turn,runId:string,value:'useful'|'not_useful') {
    try{await this.domain.rateRun(t.user,runId,value);}catch(error){return this.explain(t,error);}
    return this.say(t,`Отмечено: «${value==='useful'?'Полезно':'Не полезно'}». Оценку можно изменить другой кнопкой.`);
  }
  private async exerciseAnswer(t:Turn,runId:string) {
    return this.withRun(t,runId,async run=>{
      if(run.kind!=='exercise'||run.status!=='succeeded')return this.say(t,T.texts.stale,menuRows());
      await this.go(t,'x.answer',{c:{sid:run.sessionId,rev:run.revision,exRun:run.id}});
      return this.say(t,'Напиши свою попытку одним сообщением (до 3000 символов).');
    });
  }
  private async continueRoleplay(t:Turn,sid:string) {
    return this.withSession(t,sid,async s=>{
      const role=s.roleplays.find(r=>r.status==='active');
      const last=role?.messages.filter(m=>m.role==='assistant').at(-1);
      if(!role||!last)return this.say(t,'Активного разговора нет.',[[f('Начать тренировку','rp',sid),toMenu]]);
      await this.go(t,'rp.turn',{c:{sid,rev:s.revision,rid:role.id}});
      return this.say(t,T.roleplayMessage(last.content,role.turnCount),role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);
    });
  }

  // ---------- history
  private async history(t:Turn,page:number,cursors:(string|null)[],filter:ContextType|null) {
    const cursor=page>0?cursors[page]??undefined:undefined;
    let result;
    try{result=await this.domain.sessions(t.user,{limit:HISTORY_PAGE,...(cursor?{cursor}:{}),...(filter?{contextType:filter}:{})});}catch(error){return this.explain(t,error);}
    const next=[...cursors.slice(0,page+1)];next[page]=cursor??null;if(result.nextCursor)next[page+1]=result.nextCursor;
    await this.go(t,'h',{page,cursors:next,filter});
    const filterRow=[...CONTEXTS.map(c=>b(filter===c?`• ${T.contextLabels[c]}`:T.contextLabels[c],'hf',c))];
    if(!result.items.length&&page===0)return this.say(t,filter?`В сфере «${T.contextLabels[filter]}» разборов нет.`:'Пока нет сохранённых разборов.',[filterRow.slice(0,2),filterRow.slice(2),...(filter?[[b('Все сферы','hf','all')]]:[]),[f('Понять сообщение','m','u'),f('Пример','m','ex')],[toMenu]]);
    const lines=result.items.map((s,i)=>`${page*HISTORY_PAGE+i+1}. ${T.shortTitle(s.title)} — ${new Date(s.updatedAt).toLocaleDateString('ru-RU',{timeZone:'UTC'})}`);
    const navRow=[...(page>0?[b('← Назад','hp')]:[]),...(result.nextCursor?[b('Дальше →','hn')]:[])];
    return this.say(t,`История${filter?` · ${T.contextLabels[filter]}`:''} · страница ${page+1}\n\n${lines.join('\n')}`,[
      ...result.items.map((s,i)=>[f(`${page*HISTORY_PAGE+i+1}. ${T.shortTitle(s.title,40)}`,'ho',s.id)]),
      ...(navRow.length?[navRow]:[]),filterRow.slice(0,2),filterRow.slice(2),...(filter?[[b('Все сферы','hf','all')]]:[]),[toMenu]
    ]);
  }
  private async historyMove(t:Turn,delta:number) {
    const page=num(t.st.payload.page)+delta,cursors=(t.st.payload.cursors??[]) as (string|null)[];
    if(page<0||(delta>0&&!cursors[page]))return this.say(t,T.texts.stale);
    return this.history(t,page,cursors,(t.st.payload.filter as ContextType|null)??null);
  }
  private async openSession(t:Turn,sid:string) {
    return this.withSession(t,sid,async s=>{
      const analysis=s.runs.find(r=>r.kind==='analysis');
      const role=s.roleplays.find(r=>r.status==='active');
      const status=!analysis?'Разбор ещё не запускался.':analysis.status==='pending'?'Разбор выполняется — результат придёт сюда.':analysis.status==='failed'?`Разбор не удался: ${T.runFailure[analysis.errorCode]??''}`:'Разбор готов.';
      const rows:Rows=[];
      if(analysis?.status==='succeeded')rows.push([f('Показать разбор','ha',sid),f('Как уточнить?','cl',analysis.id)],[f('Написать ответ','rw',sid),f('Упражнение','xs',sid)],[f(role?'Продолжить разговор':'Потренировать разговор',role?'rc':'rp',sid)]);
      else if(analysis?.status!=='pending')rows.push([f('Запустить разбор','hr',sid)]);
      rows.push([f('Удалить','hd',sid),f('К истории','m','h')]);
      await this.go(t,'idle');
      const sit=s.situation;
      return this.say(t,`${s.title}\n${new Date(s.updatedAt).toLocaleString('ru-RU',{timeZone:'UTC'})} UTC\n\nСообщение: «${sit.message}»\nСобеседник: ${sit.relationship}\nЦель: ${T.goalLabels[sit.goal]}${sit.context?`\nКонтекст: ${sit.context}`:''}\n\n${status}`,rows);
    });
  }
  private async showAnalysis(t:Turn,sid:string) {
    return this.withSession(t,sid,async s=>{
      const run=s.runs.find(r=>r.kind==='analysis'&&r.status==='succeeded');
      if(!run||run.kind!=='analysis'||run.status!=='succeeded')return this.say(t,'Готового разбора нет.',[[f('Запустить разбор','hr',sid)]]);
      return this.say(t,T.analysis(run.output),this.analysisRows(sid,run.id));
    });
  }
  private analysisRows(sid:string,runId:string):Rows {
    return [[f('Как уточнить?','cl',runId)],[f('Полезно','up',runId),f('Не полезно','un',runId)],[f('Написать ответ','rw',sid),f('Упражнение','xs',sid)],[f('Потренировать разговор','rp',sid)],[toMenu]];
  }

  // ---------- delivery of finished runs (worker; no generation here)
  async deliver(t:Turn,delivery:Delivery) {
    const run=delivery.run,waiting=t.st.name==='wait'&&t.st.payload.runId===run.id;
    const rate=[f('Полезно','up',run.id),f('Не полезно','un',run.id)];
    if(run.status==='pending')return;
    if(run.status==='failed'){
      if(waiting)await this.go(t,'idle');
      return this.say(t,`${T.runFailure[run.errorCode??'']??'Не удалось получить ответ модели.'} Сохранённые данные не потеряны.`,[[f('Повторить','rt',run.id)],[toMenu]]);
    }
    switch(run.kind){
      case 'analysis':if(waiting)await this.go(t,'idle');return this.say(t,T.analysis(run.output as AnalysisOutput),this.analysisRows(run.sessionId,run.id));
      case 'reply_feedback':{
        if(waiting)await this.go(t,'idle');
        const out=run.output as ReplyFeedbackOutput,phraseRows=out.phraseFeedback.slice(0,6).map((_,n)=>[f(`${n+1}: Почему?`,`pw${n}`,run.id),f(`${n+1}: Вариант мягче`,`ps${n}`,run.id)]);
        return this.say(t,T.replyFeedback(out),[...phraseRows,rate,[f('Другой черновик','rw',run.sessionId),toMenu]]);
      }
      case 'reply_examples':if(waiting)await this.go(t,'idle');return this.say(t,`Примеры под разные цели:\n\n${T.options(run.output)}`,[rate,[f('Написать свой вариант','rw',run.sessionId)],[toMenu]]);
      case 'exercise':{
        if(waiting){await this.go(t,'x.answer',{c:{sid:run.sessionId,rev:run.revision,exRun:run.id}});return this.say(t,T.exercise(run.output),[[f('В меню','m','menu')]]);}
        return this.say(t,T.exercise(run.output),[[f('Ответить на упражнение','xa',run.id)],[toMenu]]);
      }
      case 'exercise_feedback':if(waiting)await this.go(t,'idle');return this.say(t,T.exerciseFeedback(run.output),[rate,[f('Ещё упражнение','xs',run.sessionId),toMenu]]);
      case 'roleplay_start':case 'roleplay_turn':case 'roleplay_feedback':{
        const out=run.output;
        if(out.kind==='feedback'){if(waiting)await this.go(t,'idle');return this.say(t,T.roleplayFeedback(out),[rate,[f('Ещё тренировка','rp',run.sessionId),toMenu]]);}
        const detail=await this.domain.session(t.user,run.sessionId);
        const role=detail.roleplays.find(r=>r.status==='active');
        if(!role)return this.say(t,`Собеседник:\n${out.content}`,[[toMenu]]);
        if(waiting||(t.st.name==='idle')){
          await this.go(t,'rp.turn',{c:{sid:run.sessionId,rev:run.revision,rid:role.id}});
          return this.say(t,T.roleplayMessage(out.content,role.turnCount),role.turnCount>0?[[b(`Завершить (${role.turnCount}/3)`,'fin')]]:[]);
        }
        return this.say(t,`Собеседник:\n${out.content}`,[[f('Продолжить разговор','rc',run.sessionId)]]);
      }
      case 'direct':{
        const d=(t.st.payload.c as P|undefined)?.d;
        if(waiting&&d){await this.go(t,'d.done',{d});return this.say(t,T.direct(run.output!),[rate,[b('С другой целью','dre')],[toMenu]]);}
        if(waiting)await this.go(t,'idle');
        return this.say(t,T.direct(run.output!),[rate,[f('Новая фраза','dr',run.sessionId)],[toMenu]]);
      }
    }
  }
}

export const isStale=(error:unknown)=>isDomainError(error,'STATE_CONFLICT');
