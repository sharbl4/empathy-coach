/** Web + Telegram boundary v2. This replaces transport-specific v1 DTOs for new code. */
import {z} from 'zod';
import {Id,Goal,Revision} from './index.js';
import {Account,AccountPatch,EmailRequest,EmailVerification,EmailChallenge,PrivateTelegramIdentity,TelegramUserId,TelegramUpdateId,UpdateCursor,UpdateReceipt,DeliveryFailure,DomainFailure,type UserContext,isPrivateModelUrl} from './domain.js';
export const PRODUCT_CONTRACT_VERSION='2.0.0';
const text=(max=3000)=>z.string().trim().min(1).max(max);
const date=z.iso.date(),instant=z.iso.datetime();
export const Empty=z.strictObject({});
export const Resource=z.strictObject({id:Id});
export const ContextType=z.enum(['close','colleague','teacher','client']);
export const Difficulty=z.enum(['calm','hurt','irritated']);
export const LearningMode=z.enum(['understand','say_direct','before_send','thread']);
export const Skill=z.enum(['clarification','acknowledgment','request','boundary']);
export const IntentKey=Id;
export const ProductConsentAcceptance=z.strictObject({policyVersion:z.literal('web-telegram-2'),accepted:z.literal(true)});
export const PageQuery=z.strictObject({cursor:text(500).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)});
export const HistoryQuery=PageQuery.extend({q:z.string().max(200).optional(),contextType:ContextType.optional(),mode:LearningMode.optional()});
export const ThreadTurn=z.strictObject({id:Id,speaker:z.enum(['self','other']),text:text(3000)});
export const Thread=z.array(ThreadTurn).min(1).max(20).refine(turns=>new Set(turns.map(turn=>turn.id)).size===turns.length);
export const Guess=z.strictObject({emotions:z.array(text(100)).max(3),quotes:z.array(text(6000)).max(3),unsure:z.boolean()});
const situation={title:text(200),relationship:text(200),context:z.string().max(4000),contextType:ContextType,goal:Goal};
export const SessionInputV2=z.discriminatedUnion('mode',[
  z.strictObject({...situation,mode:z.literal('understand'),message:text(6000),guess:Guess}),
  z.strictObject({...situation,mode:z.literal('say_direct'),draft:text(6000),intent:z.string().max(1000)}),
  z.strictObject({...situation,mode:z.literal('before_send'),draft:text(6000)}),
  z.strictObject({...situation,mode:z.literal('thread'),turns:Thread,guess:Guess}),
]).superRefine((value,ctx)=>{
  if('guess' in value){const source=value.mode==='thread'?value.turns.map(turn=>turn.text):[value.message];for(const quote of value.guess.quotes)if(!source.some(part=>part.includes(quote)))ctx.addIssue({code:'custom',path:['guess','quotes'],message:'Quote must occur in source'});}
});
export const SessionV2=z.strictObject({id:Id,input:SessionInputV2,revision:Revision,createdAt:instant,updatedAt:instant});
export const PageOf=<T extends z.ZodType>(item:T)=>z.strictObject({items:z.array(item).max(50),nextCursor:text(500).nullable()});
export const SessionPageV2=PageOf(SessionV2);
export const ComposerDraft=z.strictObject({mode:LearningMode.optional(),title:text(200).optional(),message:text(6000).optional(),draft:text(6000).optional(),intent:z.string().max(1000).optional(),relationship:text(200).optional(),context:z.string().max(4000).optional(),contextType:ContextType.optional(),goal:Goal.optional(),guess:Guess.optional(),turns:Thread.optional()});
export const DialogueV2=z.strictObject({revision:Revision,step:z.enum(['onboarding','email','email_code','menu','compose','guess','preview','waiting_run','exercise','roleplay','assessment','settings']),draft:ComposerDraft,sessionId:Id.nullable(),previewId:Id.nullable(),roleplayId:Id.nullable(),pendingRunId:Id.nullable()});
export const DialoguePatch=z.strictObject({expectedRevision:Revision,step:DialogueV2.shape.step,draft:ComposerDraft,sessionId:Id.nullable(),previewId:Id.nullable(),roleplayId:Id.nullable()});
export const UpdateSessionV2=z.strictObject({id:Id,expectedRevision:Revision,input:SessionInputV2});
export const PreviewKind=z.enum(['analysis','say_direct','before_send','reply_feedback','reply_examples','clarify','exercise','exercise_feedback','roleplay_start','roleplay_turn','roleplay_feedback','card_feedback']);
export const PreviewSource=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.enum(['analysis','say_direct','before_send','reply_examples','clarify','exercise']),sessionId:Id,expectedRevision:Revision}),
  z.strictObject({kind:z.literal('reply_feedback'),sessionId:Id,expectedRevision:Revision,draft:text()}),
  z.strictObject({kind:z.literal('exercise_feedback'),sessionId:Id,expectedRevision:Revision,exerciseRunId:Id,answer:text()}),
  z.strictObject({kind:z.literal('roleplay_start'),sessionId:Id,expectedRevision:Revision,difficulty:Difficulty}),
  z.strictObject({kind:z.literal('roleplay_turn'),roleplayId:Id,expectedRevision:Revision,content:text()}),
  z.strictObject({kind:z.literal('roleplay_feedback'),roleplayId:Id,expectedRevision:Revision}),
  z.strictObject({kind:z.literal('card_feedback'),cardId:text(100),contentVersion:text(100),answer:text()}),
]);
export const PreviewTextField=z.strictObject({id:Id,label:text(200),value:z.string().max(12000),editable:z.boolean()});
export const TokenBudget=z.strictObject({contextWindow:z.number().int().positive(),templateTokens:z.number().int().nonnegative(),systemTokens:z.number().int().nonnegative(),inputTokens:z.number().int().nonnegative(),maxOutputTokens:z.number().int().positive(),reserveTokens:z.number().int().nonnegative(),fit:z.enum(['fits','too_large','unknown'])}).superRefine((value,ctx)=>{
  const total=value.templateTokens+value.systemTokens+value.inputTokens+value.maxOutputTokens+value.reserveTokens;
  if((value.fit==='fits'&&total>value.contextWindow)||(value.fit==='too_large'&&total<=value.contextWindow))ctx.addIssue({code:'custom',message:'Inconsistent token budget'});
});
export const Preview=z.strictObject({id:Id,revision:Revision,kind:PreviewKind,sessionId:Id.nullable(),sessionRevision:Revision.nullable(),fields:z.array(PreviewTextField).min(1).max(100),turns:z.array(z.strictObject({fieldId:Id,speaker:z.enum(['self','other']),order:z.number().int().nonnegative()})).max(20),redactionCount:z.number().int().nonnegative(),budget:TokenBudget,modelRevision:text(200),promptVersion:text(100),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),confirmedAt:instant.nullable(),safety:z.enum(['none','support'])});
export const EditPreview=z.strictObject({id:Id,expectedRevision:Revision,edits:z.array(z.strictObject({fieldId:Id,value:z.string().max(12000)})).min(1).max(100)});
export const ConfirmPreview=z.strictObject({id:Id,expectedRevision:Revision,snapshotHash:z.string().regex(/^[a-f0-9]{64}$/)});
export const PreviewReceipt=z.strictObject({id:Id,revision:Revision,snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),confirmedAt:instant,expiresAt:instant});
export const StartRun=z.strictObject({previewId:Id,previewRevision:Revision,expectedSessionRevision:Revision.nullable()});
export const Evidence=z.strictObject({fieldId:Id,quote:text(6000)});
export const AnalysisV2=z.strictObject({literalMeaning:text(),interpretations:z.array(z.strictObject({emotion:text(500),possibleNeed:text(500),explanation:text(),basis:z.enum(['text','context','insufficient']),evidence:z.array(Evidence).max(8)})).min(2).max(3),uncertainty:text(),clarifyingQuestion:text(500),comparison:z.strictObject({matches:z.array(text(500)).max(8),alternatives:z.array(text(500)).max(8),toClarify:z.array(text(500)).max(8)}),skillTip:text(500)});
export const Phrase=z.strictObject({fieldId:Id,quote:text(),tone:z.enum(['good','caution','risky']),why:text(1000),softer:text(1000)});
export const FourGoals=z.array(z.strictObject({goal:Goal,text:text(),explanation:text(500)})).length(4).refine(items=>new Set(items.map(item=>item.goal)).size===4);
export const DraftFeedback=z.strictObject({strengths:z.array(text(500)).max(8),phrases:z.array(Phrase).max(12),revisedReply:text(),options:FourGoals});
export const DirectV2=z.strictObject({variants:z.array(z.strictObject({text:text(),explanation:text(1000)})).min(1).max(3),preservedMeaning:text(1000),changeNotes:z.array(text(500)).max(8)});
export const Feedback=z.strictObject({strengths:z.array(text(500)).max(8),improvement:text(),suggestedAttempt:text()});
export const RoleFeedback=z.strictObject({kind:z.literal('feedback'),strengths:z.array(text(500)).max(8),improvements:z.array(text(500)).max(8),nextPractice:text(500)});
export const RoleMessage=z.strictObject({kind:z.literal('message'),content:text()});
export const modelOutputsV2={analysis:AnalysisV2,say_direct:DirectV2,before_send:DraftFeedback,reply_feedback:DraftFeedback,reply_examples:FourGoals,clarify:z.strictObject({questions:z.array(text(500)).min(1).max(3),explanation:text(1000)}),exercise:z.strictObject({instruction:text(),skill:Skill,exampleHint:text(500)}),exercise_feedback:Feedback,roleplay_start:RoleMessage,roleplay_turn:z.discriminatedUnion('kind',[RoleMessage,RoleFeedback]),roleplay_feedback:RoleFeedback,card_feedback:Feedback} as const;
export const MODEL_PROMPT_VERSION='between-product-v2';
export const OutputTokenLimits={analysis:1400,say_direct:700,before_send:1400,reply_feedback:1400,reply_examples:1000,clarify:350,exercise:500,exercise_feedback:700,roleplay_start:350,roleplay_turn:700,roleplay_feedback:700,card_feedback:700} as const;
const runBase={id:Id,sessionId:Id.nullable(),revision:Revision,previewId:Id,previewRevision:Revision,modelRevision:text(200),promptVersion:text(100),createdAt:instant,updatedAt:instant};
export const RunErrorV2=z.enum(['RUN_INTERRUPTED','MODEL_TIMEOUT','MODEL_UNAVAILABLE','MODEL_INVALID_OUTPUT','MODEL_REFUSED','PREVIEW_STALE','INPUT_TOO_LARGE','CONFIGURATION_ERROR']);
function runVariant<K extends keyof typeof modelOutputsV2>(kind:K){return z.discriminatedUnion('status',[
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('pending'),phase:z.enum(['queued','running']),queuePosition:z.number().int().nonnegative().nullable(),output:z.null(),errorCode:z.null()}),
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('failed'),phase:z.null(),queuePosition:z.null(),output:z.null(),errorCode:RunErrorV2}),
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('succeeded'),phase:z.null(),queuePosition:z.null(),output:modelOutputsV2[kind],errorCode:z.null()}),
]);}
export const RunV2=z.union([runVariant('analysis'),runVariant('say_direct'),runVariant('before_send'),runVariant('reply_feedback'),runVariant('reply_examples'),runVariant('clarify'),runVariant('exercise'),runVariant('exercise_feedback'),runVariant('roleplay_start'),runVariant('roleplay_turn'),runVariant('roleplay_feedback'),runVariant('card_feedback')]);
export const RunAcceptedV2=z.strictObject({runId:Id,resourceId:Id.optional()});
export const RoleplayV2=z.strictObject({id:Id,sessionId:Id,revision:Revision,difficulty:Difficulty,status:z.enum(['active','completed']),turnCount:z.number().int().min(0).max(3),messages:z.array(z.strictObject({id:Id,sequence:z.number().int().nonnegative(),role:z.enum(['user','assistant']),content:text()})).max(7),feedback:RoleFeedback.nullable()});
export const SessionDetailV2=SessionV2.extend({runs:z.array(RunV2).max(1000),roleplays:z.array(RoleplayV2).max(100)});
export const Example=z.strictObject({id:text(100),version:text(100),input:SessionInputV2});
export const Timezone=text(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}});
export const Clock=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const QuietHours=z.strictObject({enabled:z.boolean(),start:Clock,end:Clock}).refine(value=>!value.enabled||value.start!==value.end);
export const ReminderSettings=z.strictObject({revision:Revision,enabled:z.boolean(),timezone:Timezone,localTime:Clock,quietHours:QuietHours});
export const ReminderPatch=z.strictObject({expectedRevision:Revision,enabled:z.boolean(),timezone:Timezone,localTime:Clock,quietHours:QuietHours});
export const Practice=z.strictObject({id:text(100),contentVersion:text(100),localDate:date,title:text(200),instruction:text(1000),skill:Skill});
export const Completion=z.strictObject({id:Id,contentId:text(100),contentVersion:text(100),localDate:date,completedAt:instant});
export const CompleteContent=z.strictObject({id:text(100),contentVersion:text(100)});
export const Card=z.strictObject({id:text(100),contentVersion:text(100),skill:Skill,title:text(200),theory:text(2000),example:text(1000),practice:text(1000),completed:z.boolean()});
export const AssessmentTask=z.strictObject({id:text(100),prompt:text(1000),choices:z.array(z.strictObject({id:text(100),text:text(1000)})).min(2).max(5),rubric:z.strictObject({zero:text(500),one:text(500),two:text(500)})});
export const AssessmentForm=z.strictObject({id:Id,contentVersion:text(100),kind:z.enum(['baseline','followup']),tasks:z.array(AssessmentTask).min(3).max(5),eligibleAt:instant,submittedAt:instant.nullable()});
export const AssessmentSubmit=z.strictObject({id:Id,contentVersion:text(100),answers:z.array(z.strictObject({questionId:text(100),choiceId:text(100)})).min(3).max(5)}).refine(value=>new Set(value.answers.map(answer=>answer.questionId)).size===value.answers.length);
export const AssessmentResult=z.strictObject({id:Id,kind:z.enum(['baseline','followup']),scores:z.array(z.strictObject({questionId:text(100),score:z.number().int().min(0).max(2),rationale:text(1000)})).min(3).max(5),completedAt:instant,followupEligibleAt:instant.nullable(),notice:z.literal('Учебный результат, не оценка эмпатии и не доказательство психологического эффекта')});
export const SkillAttempt=z.strictObject({id:Id,skill:Skill,score:z.number().int().min(0).max(2),rationale:text(1000),sourceRunId:Id,createdAt:instant});
export const ProgressV2=z.strictObject({analyzedSessions:z.number().int().nonnegative(),completedExercises:z.number().int().nonnegative(),completedRoleplays:z.number().int().nonnegative(),completedDailyPractices:z.number().int().nonnegative(),completedCards:z.number().int().nonnegative(),streak:z.strictObject({current:z.number().int().nonnegative(),best:z.number().int().nonnegative(),lastCompletedLocalDate:date.nullable()}),skills:z.array(z.strictObject({skill:Skill,completedAttempts:z.number().int().nonnegative(),latestScore:z.number().int().min(0).max(2).nullable()})).max(4),latestTip:text(500).nullable(),followupEligibleAt:instant.nullable()});
export const Vote=z.strictObject({runId:Id,value:z.enum(['useful','not_useful'])});
export const StageEvent=z.strictObject({name:z.enum(['onboarding_started','onboarding_completed','preview_created','preview_confirmed','run_completed','practice_completed','card_completed','assessment_completed']),contextType:ContextType.optional(),resourceId:Id.optional()});
export const OperationalAnalytics=z.strictObject({events:z.array(z.strictObject({name:StageEvent.shape.name,count:z.number().int().nonnegative()})),contexts:z.array(z.strictObject({contextType:ContextType,count:z.number().int().nonnegative()})),usefulness:z.strictObject({useful:z.number().int().nonnegative(),notUseful:z.number().int().nonnegative()})});
export const Support=z.strictObject({countryCode:z.string().regex(/^[A-Z]{2}$/),region:text(100).nullable(),message:text(),recognitionGuaranteed:z.literal(false),contacts:z.array(z.strictObject({label:text(200),phone:text(100).nullable(),url:z.url().nullable(),sourceUrl:z.url(),verifiedAt:instant})).max(10)});
export const ProductErrorCode=z.enum(['VALIDATION_ERROR','UNAUTHORIZED','FORBIDDEN','CSRF_FAILED','ORIGIN_FORBIDDEN','EMAIL_NOT_VERIFIED','CONSENT_REQUIRED','CODE_INVALID','CODE_EXPIRED','NOT_FOUND','REVISION_CONFLICT','PREVIEW_STALE','PREVIEW_NOT_CONFIRMED','INPUT_TOO_LARGE','IDEMPOTENCY_CONFLICT','OPERATION_IN_PROGRESS','RATE_LIMITED','LINK_EXPIRED','LINK_ALREADY_USED','ACCOUNT_CONFLICT','ASSESSMENT_NOT_DUE','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export const ProductError=z.strictObject({error:z.strictObject({code:ProductErrorCode,requestId:text(100),retryAfterSeconds:z.number().int().nonnegative().optional()})});
type Schema=z.ZodType;
const read=<I extends Schema,O extends Schema>(input:I,response:O)=>({input,response,mutable:false as const});
const write=<I extends Schema,O extends Schema>(input:I,response:O)=>({input,response,mutable:true as const});
export const operations={
  account:read(Empty,Account),updateAccount:write(AccountPatch,Account),acceptConsent:write(ProductConsentAcceptance,Account),revokeConsent:write(Empty,z.null()),
  requestEmailCode:write(EmailRequest,EmailChallenge),verifyEmailCode:write(EmailVerification,Account),
  dialogue:read(Empty,DialogueV2),updateDialogue:write(DialoguePatch,DialogueV2),resetDialogue:write(z.strictObject({expectedRevision:Revision}),DialogueV2),
  createSession:write(SessionInputV2,SessionV2),sessions:read(HistoryQuery,SessionPageV2),session:read(Resource,SessionDetailV2),updateSession:write(UpdateSessionV2,SessionV2),
  deleteSession:write(Resource,z.null()),deleteData:write(z.strictObject({confirmation:z.literal('DELETE_MY_LEARNING_DATA')}),z.null()),deleteAccount:write(z.strictObject({confirmation:z.literal('DELETE_MY_ACCOUNT')}),z.null()),
  createPreview:write(PreviewSource,Preview),preview:read(Resource,Preview),editPreview:write(EditPreview,Preview),confirmPreview:write(ConfirmPreview,PreviewReceipt),
  startRun:write(StartRun,RunAcceptedV2),run:read(Resource,RunV2),retry:write(z.strictObject({id:Id,previewId:Id,previewRevision:Revision,expectedRevision:Revision}),RunAcceptedV2),
  examples:read(PageQuery.extend({contextType:ContextType.optional()}),PageOf(Example)),example:read(z.strictObject({id:text(100)}),Example),
  progress:read(Empty,ProgressV2),skillAttempts:read(PageQuery.extend({skill:Skill.optional()}),PageOf(SkillAttempt)),
  dailyPractice:read(Empty,Practice),completeDailyPractice:write(CompleteContent,Completion),
  cards:read(PageQuery.extend({skill:Skill.optional()}),PageOf(Card)),card:read(z.strictObject({id:text(100)}),Card),completeCard:write(CompleteContent,Completion),
  reminders:read(Empty,ReminderSettings),updateReminders:write(ReminderPatch,ReminderSettings),
  assessment:read(z.strictObject({kind:z.enum(['baseline','followup'])}),AssessmentForm),submitAssessment:write(AssessmentSubmit,AssessmentResult),assessmentResults:read(PageQuery,PageOf(AssessmentResult)),
  rateRun:write(Vote,Vote),recordStage:write(StageEvent,z.null()),support:read(z.strictObject({countryCode:z.string().regex(/^[A-Z]{2}$/),region:text(100).optional()}),Support),
} as const;
export type Operation=keyof typeof operations;
export type OperationInput<K extends Operation>=z.infer<(typeof operations)[K]['input']>;
export type OperationOutput<K extends Operation>=z.infer<(typeof operations)[K]['response']>;
export type UserMethods={[K in Operation]:(ctx:UserContext,input:OperationInput<K>,...intent:(typeof operations)[K]['mutable'] extends true?[key:string]:[])=>Promise<OperationOutput<K>>};
export const WEB_LINK_TTL_SECONDS=300,WEB_SESSION_TTL_SECONDS=86400,WEB_SESSION_IDLE_SECONDS=7200;
export const WEB_SESSION_COOKIE='__Host-between-session',WEB_BINDING_COOKIE='__Host-between-link';
export const DevSessionCookie='between_session_dev',DevBindingCookie='between_link_dev';
export const WebLinkId=Id;
export const WebLinkStatus=z.enum(['pending','approved','denied','consumed','expired']);
export const WebLink=z.strictObject({id:Id,status:WebLinkStatus,expiresAt:instant,pollAfterMs:z.number().int().min(1000).max(5000)});
export const WebLinkStart=WebLink.extend({telegramUrl:z.url(),confirmationCode:z.string().regex(/^[0-9]{8}$/)});
export const PublicWebSession=z.discriminatedUnion('authenticated',[
  z.strictObject({authenticated:z.literal(false),csrfToken:text(200)}),
  z.strictObject({authenticated:z.literal(true),account:Account,csrfToken:text(200),expiresAt:instant}),
]);
export const WebSessionInfo=z.strictObject({id:Id,createdAt:instant,expiresAt:instant,isCurrent:z.boolean()});
export const WebSessionPage=PageOf(WebSessionInfo);
declare const browserBrand:unique symbol;
export type BrowserContext=Readonly<{[browserBrand]:true}>;
/** Private result for the HTTP adapter. Never serialize this object as a response. */
export interface BrowserAccess {context:BrowserContext;setBindingCookie?:string;publicSession:z.infer<typeof PublicWebSession>;}
export interface ConsumedWebLink {context:UserContext;setSessionCookie:string;publicSession:z.infer<typeof PublicWebSession>;}
export interface PollerLease {readonly signal:AbortSignal;release():Promise<void>;}
export interface Delivery {readonly id:string;readonly context:UserContext;readonly run:z.infer<typeof RunV2>;readonly attempt:number;}
export interface ProductLifecycle {
  readonly shutdownSignal:AbortSignal;
  start():Promise<void>;
  close():Promise<void>;
  acquirePollerLease(botId:string):Promise<PollerLease>;
  resolveUser(identity:z.infer<typeof PrivateTelegramIdentity>):Promise<UserContext>;
  resolveWebSession(serverCookieToken:string):Promise<UserContext>;
  openBrowser(serverBindingCookieToken?:string,serverSessionCookieToken?:string):Promise<BrowserAccess>;
  beginWebLink(browser:BrowserContext,key:string):Promise<z.infer<typeof WebLinkStart>>;
  webLinkStatus(browser:BrowserContext,id:string):Promise<z.infer<typeof WebLink>>;
  consumeWebLink(browser:BrowserContext,id:string,key:string):Promise<ConsumedWebLink>;
  inspectWebLink(ctx:UserContext,claimCode:string,key:string):Promise<z.infer<typeof WebLinkStart>>;
  approveWebLink(ctx:UserContext,input:{id:string;decision:'approve'|'deny'},key:string):Promise<z.infer<typeof WebLink>>;
  webSessions(ctx:UserContext):Promise<z.infer<typeof WebSessionPage>>;
  revokeWebSession(ctx:UserContext,id:string,key:string):Promise<void>;
  revokeCurrentWebSession(ctx:UserContext,key:string):Promise<void>;
  revokeAllWebSessions(ctx:UserContext,key:string):Promise<void>;
  updateCursor():Promise<z.infer<typeof UpdateCursor>>;
  claimUpdate(ctx:UserContext,updateId:string):Promise<z.infer<typeof UpdateReceipt>>;
  acknowledgeUpdate(updateId:string):Promise<void>;
  claimDeliveries(limit:number):Promise<Delivery[]>;
  completeDelivery(ctx:UserContext,id:string):Promise<void>;
  failDelivery(ctx:UserContext,id:string,input:z.infer<typeof DeliveryFailure>):Promise<void>;
  health():Promise<{database:boolean;workers:boolean;scheduler:boolean;pollerLease:boolean}>;
}
export type ProductFacade=UserMethods&ProductLifecycle;
export interface ProductOptions {databaseUrl:string;ai:{provider:'local';baseUrl:string;model:string;apiKey?:string;timeoutMs:number;maxConcurrency:1;maxQueueLength:number};smtp:{host:string;port:number;user?:string;password?:string;from:string};emailCodeSecret:string;web:{origin:string;sessionSecret:string;linkSecret:string;telegramBotUsername:string};}
export type CreateProductDomain=(options:ProductOptions)=>Promise<ProductFacade>;
export interface TelegramTransport {identify():Promise<{botId:string;username:string}>;start(domain:ProductFacade,lease:PollerLease):Promise<void>;stop():Promise<void>;readonly finished:Promise<void>;}
export type CreateTelegramTransport=(options:{token:string})=>TelegramTransport;
export const RuntimeHealth=z.strictObject({pid:z.number().int().positive(),heartbeatAt:instant,database:z.boolean(),http:z.boolean(),polling:z.boolean(),workers:z.boolean(),scheduler:z.boolean()});
export const RuntimeEnvironmentV2=z.object({NODE_ENV:z.enum(['development','test','production']).default('development'),DATABASE_URL:z.url(),TELEGRAM_BOT_TOKEN:text(200),AI_PROVIDER:z.literal('local'),LOCAL_LLM_BASE_URL:z.url(),LOCAL_LLM_MODEL:text(200),LOCAL_LLM_API_KEY:z.string().optional(),AI_TIMEOUT_MS:z.coerce.number().int().min(1000).max(300000).default(90000),AI_MAX_CONCURRENCY:z.coerce.number().int().min(1).max(1).default(1),AI_MAX_QUEUE_LENGTH:z.coerce.number().int().min(1).max(20).default(8),SMTP_HOST:text(253),SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(587),SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),SMTP_FROM:z.email(),EMAIL_CODE_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),WEB_ORIGIN:z.url(),WEB_SESSION_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),WEB_LINK_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),PORT:z.coerce.number().int().min(1).max(65535).default(3000),TRUSTED_PROXY_IPS:z.string().default('')}).superRefine((value,ctx)=>{
  const origin=new URL(value.WEB_ORIGIN),production=value.NODE_ENV==='production';
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||(production?origin.protocol!=='https:':!['http:','https:'].includes(origin.protocol)))ctx.addIssue({code:'custom',path:['WEB_ORIGIN'],message:'Explicit origin required'});
  if(!isPrivateModelUrl(value.LOCAL_LLM_BASE_URL,production))ctx.addIssue({code:'custom',path:['LOCAL_LLM_BASE_URL'],message:'Private model endpoint required'});
  if(production&&(value.LOCAL_LLM_API_KEY?.length??0)<32)ctx.addIssue({code:'custom',path:['LOCAL_LLM_API_KEY'],message:'Strong endpoint key required'});
  if(new Set([value.EMAIL_CODE_SECRET,value.WEB_SESSION_SECRET,value.WEB_LINK_SECRET]).size!==3)ctx.addIssue({code:'custom',message:'Independent secrets required'});
  if(value.TRUSTED_PROXY_IPS.split(',').filter(Boolean).some(part=>!/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(part.trim())))ctx.addIssue({code:'custom',path:['TRUSTED_PROXY_IPS'],message:'Exact proxy IPs only; no wildcard, boolean or broad CIDR'});
});
export function validateEvidenceV2(kind:keyof typeof modelOutputsV2,output:unknown,fields:ReadonlyArray<{id:string;value:string}>){
  const result=modelOutputsV2[kind].parse(output),sources=new Map(fields.map(field=>[field.id,field.value]));
  if(kind==='analysis'){const parsed=AnalysisV2.parse(result);for(const interpretation of parsed.interpretations)for(const evidence of interpretation.evidence)if(!sources.get(evidence.fieldId)?.includes(evidence.quote))throw new Error('MODEL_INVALID_OUTPUT');}
  if(kind==='reply_feedback'||kind==='before_send'){for(const phrase of DraftFeedback.parse(result).phrases)if(!sources.get(phrase.fieldId)?.includes(phrase.quote))throw new Error('MODEL_INVALID_OUTPUT');}
  return result;
}
export {Id,Goal,Revision,Account,PrivateTelegramIdentity,TelegramUserId,TelegramUpdateId,DomainFailure};
export type {UserContext};
