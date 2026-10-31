/** Telegram-only in-process boundary v1. Old HTTP DTOs in index.ts are archival. */
import {z} from 'zod';
import {Id,Revision,Goal,SessionInput,UpdateSession,Session,SessionDetail,SessionQuery,SessionPage,Run,RunAccepted,ReplyRequest,ExpectedRevision,ExerciseAnswer,TurnRequest,Progress,DeleteData,Roleplay,Analysis,ReplyFeedback,ReplyOptions,Exercise,ExerciseFeedback,RoleplayMessageOutput,RoleplayOutput,RoleplayFeedbackOutput} from './index.js';
export const TELEGRAM_CONTRACT_VERSION='1.0.0';
const text=(max:number)=>z.string().trim().min(1).max(max);
/** PostgreSQL BIGINT; never a JS number at this boundary. */
export const TelegramUserId=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>BigInt(value)<=9223372036854775807n);
export const TelegramUpdateId=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value=>BigInt(value)<=9223372036854775807n);
export const UpdateReceipt=z.strictObject({updateId:TelegramUpdateId,intentKey:Id,status:z.enum(['processing','completed'])});
export const UpdateCursor=z.strictObject({nextOffset:TelegramUpdateId});
export const PrivateTelegramIdentity=z.strictObject({telegramUserId:TelegramUserId,privateChatId:TelegramUserId,updateId:TelegramUpdateId}).refine(value=>value.telegramUserId===value.privateChatId,'Private chat must match sender');
export type PrivateTelegramIdentity=z.infer<typeof PrivateTelegramIdentity>;
export type TelegramUserId=z.infer<typeof TelegramUserId>;
/** Runtime issuer/WeakSet checks MUST be implemented by createDomain, not just this TS brand. */
declare const userContextBrand:unique symbol;
export type UserContext=Readonly<{accountId:string;telegramUserId:TelegramUserId;[userContextBrand]:true}>;
export const ConsentAcceptance=z.strictObject({policyVersion:z.literal('telegram-1'),accepted:z.literal(true)});
export const Account=z.strictObject({id:Id,telegramUserId:TelegramUserId,displayName:text(100),emailVerified:z.boolean(),consentVersion:z.string().max(100).nullable(),onboardingCompletedAt:z.iso.datetime().nullable()});
export const AccountPatch=z.strictObject({displayName:text(100).optional(),onboardingCompleted:z.literal(true).optional()}).refine(value=>Object.keys(value).length>0);
export const EmailRequest=z.strictObject({email:z.email().max(254)});
export const EmailChallenge=z.strictObject({challengeId:Id,expiresAt:z.iso.datetime(),resendAfter:z.iso.datetime()});
export const EmailVerification=z.strictObject({challengeId:Id,code:z.string().regex(/^[0-9]{6}$/)});
export const EMAIL_CODE_TTL_SECONDS=600;
export const EMAIL_CODE_MAX_ATTEMPTS=5;
export const EMAIL_RESEND_SECONDS=60;
export const IdempotencyKey=Id;
export const DeleteAccount=z.strictObject({confirmation:z.literal('DELETE_MY_ACCOUNT')});
export const BOT_HEALTH_FILE='/tmp/between-bot-health.json';
export const BotHealth=z.strictObject({pid:z.number().int().positive(),heartbeatAt:z.iso.datetime(),database:z.boolean(),pollerLease:z.boolean(),polling:z.boolean()});
export const DialogueStage=z.enum(['onboarding','email','email_code','menu','message','relationship','context','goal','guess','draft','exercise_answer','roleplay','direct_feeling','direct_need','direct_request','waiting_run']);
export const DialogueDraft=z.strictObject({title:text(200).optional(),message:text(6000).optional(),relationship:text(200).optional(),context:z.string().max(4000).optional(),goal:Goal.optional(),emotions:z.array(text(100)).max(3).optional(),evidenceQuotes:z.array(text(6000)).max(3).optional(),unsure:z.boolean().optional(),draft:text(3000).optional(),feeling:text(300).optional(),need:text(500).optional(),request:text(1000).optional()});
export const Dialogue=z.strictObject({revision:Revision,stage:DialogueStage,draft:DialogueDraft,sessionId:Id.nullable(),roleplayId:Id.nullable(),pendingRunId:Id.nullable()});
export const DialogueUpdate=z.strictObject({expectedRevision:Revision,stage:DialogueStage,draft:DialogueDraft,sessionId:Id.nullable(),roleplayId:Id.nullable()});
/** Anton approved: express one's own feelings/needs, not diagnose the recipient. */
export const SayDirectRequest=ExpectedRevision.extend({feeling:text(300),need:text(500),request:text(1000),draft:text(3000).optional()});
export const SayDirectOutput=z.strictObject({observation:text(1000),feeling:text(300),need:text(500),request:text(1000),message:text(3000),explanation:text(1000)});
export const DomainRunKind=z.enum(['analysis','reply_feedback','reply_examples','exercise','exercise_feedback','roleplay_start','roleplay_turn','roleplay_feedback','say_direct']);
export const DomainRunErrorCode=z.enum(['RUN_INTERRUPTED','MODEL_TIMEOUT','MODEL_UNAVAILABLE','MODEL_INVALID_OUTPUT','MODEL_REFUSED','CONFIGURATION_ERROR']);
const runBase={id:Id,sessionId:Id,revision:Revision,createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()};
const DirectRun=z.discriminatedUnion('status',[
  z.strictObject({...runBase,kind:z.literal('say_direct'),status:z.literal('pending'),output:z.null(),errorCode:z.null()}),
  z.strictObject({...runBase,kind:z.literal('say_direct'),status:z.literal('failed'),output:z.null(),errorCode:DomainRunErrorCode}),
  z.strictObject({...runBase,kind:z.literal('say_direct'),status:z.literal('succeeded'),output:SayDirectOutput,errorCode:z.null()}),
]);
export const DomainRun=z.union([Run,DirectRun]);
export const DomainSessionDetail=Session.extend({runs:z.array(DomainRun).max(1000),roleplays:z.array(Roleplay).max(100)});
export const DomainErrorCode=z.enum(['VALIDATION_ERROR','UNAUTHORIZED','EMAIL_NOT_VERIFIED','CONSENT_REQUIRED','CODE_INVALID','CODE_EXPIRED','NOT_FOUND','REVISION_CONFLICT','OPERATION_IN_PROGRESS','IDEMPOTENCY_CONFLICT','RATE_LIMITED','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export const DomainFailure=z.strictObject({code:DomainErrorCode,requestId:text(100)});
export const domainOutputs={analysis:Analysis,reply_feedback:ReplyFeedback,reply_examples:ReplyOptions,exercise:Exercise,exercise_feedback:ExerciseFeedback,roleplay_start:RoleplayMessageOutput,roleplay_turn:RoleplayOutput,roleplay_feedback:RoleplayFeedbackOutput,say_direct:SayDirectOutput} as const;
export type DomainRun=z.infer<typeof DomainRun>;
export type DomainFailure=z.infer<typeof DomainFailure>;
type Input<S extends z.ZodType>=z.infer<S>;
/** Direct method calls only. No Fastify, Supabase token or HTTP client between bot and domain. */
export interface DomainFacade {
  readonly shutdownSignal:AbortSignal;
  updateCursor():Promise<Input<typeof UpdateCursor>>;
  resolveUser(identity:PrivateTelegramIdentity):Promise<UserContext>;
  claimUpdate(ctx:UserContext,updateId:string):Promise<Input<typeof UpdateReceipt>>;
  acknowledgeUpdate(updateId:string):Promise<void>;
  account(ctx:UserContext):Promise<Input<typeof Account>>;
  updateAccount(ctx:UserContext,input:Input<typeof AccountPatch>,key:string):Promise<Input<typeof Account>>;
  acceptConsent(ctx:UserContext,input:Input<typeof ConsentAcceptance>,key:string):Promise<Input<typeof Account>>;
  revokeConsent(ctx:UserContext,key:string):Promise<void>;
  requestEmailCode(ctx:UserContext,input:Input<typeof EmailRequest>,key:string):Promise<Input<typeof EmailChallenge>>;
  verifyEmailCode(ctx:UserContext,input:Input<typeof EmailVerification>,key:string):Promise<Input<typeof Account>>;
  dialogue(ctx:UserContext):Promise<Input<typeof Dialogue>>;
  updateDialogue(ctx:UserContext,input:Input<typeof DialogueUpdate>,key:string):Promise<Input<typeof Dialogue>>;
  resetDialogue(ctx:UserContext,expectedRevision:number,key:string):Promise<Input<typeof Dialogue>>;
  createSession(ctx:UserContext,input:Input<typeof SessionInput>,key:string):Promise<Input<typeof Session>>;
  sessions(ctx:UserContext,query:Input<typeof SessionQuery>):Promise<Input<typeof SessionPage>>;
  session(ctx:UserContext,id:string):Promise<Input<typeof DomainSessionDetail>>;
  updateSession(ctx:UserContext,id:string,input:Input<typeof UpdateSession>,key:string):Promise<Input<typeof Session>>;
  deleteSession(ctx:UserContext,id:string,key:string):Promise<void>;
  deleteData(ctx:UserContext,input:Input<typeof DeleteData>,key:string):Promise<void>;
  deleteAccount(ctx:UserContext,input:Input<typeof DeleteAccount>,key:string):Promise<void>;
  analyze(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  replyFeedback(ctx:UserContext,id:string,input:Input<typeof ReplyRequest>,key:string):Promise<Input<typeof RunAccepted>>;
  replyExamples(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  exercise(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  exerciseFeedback(ctx:UserContext,id:string,input:Input<typeof ExerciseAnswer>,key:string):Promise<Input<typeof RunAccepted>>;
  roleplayStart(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  roleplayTurn(ctx:UserContext,id:string,input:Input<typeof TurnRequest>,key:string):Promise<Input<typeof RunAccepted>>;
  roleplayFinish(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  sayDirect(ctx:UserContext,id:string,input:Input<typeof SayDirectRequest>,key:string):Promise<Input<typeof RunAccepted>>;
  retry(ctx:UserContext,id:string,input:Input<typeof ExpectedRevision>,key:string):Promise<Input<typeof RunAccepted>>;
  run(ctx:UserContext,id:string):Promise<DomainRun>;
  progress(ctx:UserContext):Promise<Input<typeof Progress>>;
  health():Promise<{database:boolean;pollerLease:boolean}>;
  close():Promise<void>;
}
export interface DomainOptions {
  databaseUrl:string;
  ai:{provider:'local';baseUrl:string;model:string;apiKey?:string;timeoutMs:number;maxConcurrency:number};
  smtp:{host:string;port:number;user?:string;password?:string;from:string};
  emailCodeSecret:string;
  /** Must be bound to getMe()'s actual bot ID, not the secret token. */
  botId:string;
}
export type CreateDomain=(options:DomainOptions)=>Promise<DomainFacade>;
export function isPrivateModelUrl(value:string,production=false):boolean {
  try{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/\/v1\/?$/.test(url.pathname))return false;
    const parts=url.hostname.split('.').map(Number),ipv4=parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
    const tailnet=ipv4&&parts[0]===100&&parts[1]>=64&&parts[1]<=127;
    const local=!production&&(url.hostname==='localhost'||url.hostname==='[::1]'||(ipv4&&(parts[0]===127||parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168))));
    // Use numeric Tailscale IPs to avoid DNS rebinding/public endpoint ambiguity.
    return tailnet||local;
  }catch{return false;}
}
export const RuntimeEnvironment=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),DATABASE_URL:z.string().url(),
  TELEGRAM_BOT_TOKEN:z.string().regex(/^[0-9]+:[A-Za-z0-9_-]{20,}$/),AI_PROVIDER:z.literal('local'),
  LOCAL_LLM_BASE_URL:z.string().url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&/\/v1\/?$/.test(url.pathname);}),
  LOCAL_LLM_MODEL:text(200),LOCAL_LLM_API_KEY:z.string().optional(),AI_TIMEOUT_MS:z.coerce.number().int().min(1000).max(300000).default(90000),AI_MAX_CONCURRENCY:z.coerce.number().int().min(1).max(2).default(1),
  SMTP_HOST:text(253),SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(587),SMTP_USER:z.string().optional(),SMTP_PASSWORD:z.string().optional(),SMTP_FROM:z.email(),EMAIL_CODE_SECRET:z.string().regex(/^[a-fA-F0-9]{64,}$/),
}).superRefine((value,ctx)=>{
  if(!isPrivateModelUrl(value.LOCAL_LLM_BASE_URL,value.NODE_ENV==='production'))ctx.addIssue({code:'custom',path:['LOCAL_LLM_BASE_URL'],message:'Private model endpoint required'});
  if(value.NODE_ENV==='production'&&(value.LOCAL_LLM_API_KEY?.length??0)<32)ctx.addIssue({code:'custom',path:['LOCAL_LLM_API_KEY'],message:'Strong model authentication key required'});
});
// All live DTO validators available to both transport and facade implementer.
export {Id,Revision,Goal,SessionInput,UpdateSession,Session,SessionDetail,SessionQuery,SessionPage,RunAccepted,ReplyRequest,ExpectedRevision,ExerciseAnswer,TurnRequest,Progress,DeleteData};
