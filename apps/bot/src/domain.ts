import type {z} from 'zod';
import type {Goal,OutputFor,Progress,Run,RunAccepted,Session,SessionDetail,SessionPage,ErrorCode} from '@between/contracts';

// Port the Telegram transport needs from the domain facade (@between/api).
// PROPOSAL for Anton/Dima (team-prompts-telegram v3): names follow existing Storage/Runs.
// Replace with the exported facade and contracts DTOs once they are fixed. No HTTP, no bearer.

/** Built only by the transport from ctx.from.id; never from text or callback payload. */
export interface UserContext {readonly telegramId:string}

export type GoalValue=z.infer<typeof Goal>;
export type ContextType='close'|'colleague'|'teacher'|'client';
export type Difficulty='calm'|'hurt'|'irritated';

export type AccountStatus='new'|'email_pending'|'verified';
export interface Account {
  telegramId:string;
  status:AccountStatus;
  onboardingCompleted:boolean;
  email:string|null;
  /** Address awaiting confirmation (first one or a change). */
  pendingEmail:string|null;
}
export type CodeResult={status:'verified'}|{status:'invalid';attemptsLeft:number}|{status:'expired'}|{status:'locked'};

export interface DialogState {name:string;version:number;payload:Record<string,unknown>}

// --- Input preview: masking happens in the domain before any model call (section 11).
export type DraftKind='understand'|'direct'|'reply'|'exercise_answer'|'roleplay_turn';
export interface DraftFields {
  kind:DraftKind;
  message?:string;relationship?:string;context?:string;contextType?:ContextType;goal?:GoalValue;
  guess?:{emotions:string[];evidenceQuotes:string[];unsure:boolean};
  intent?:string;attempt?:string|null;text?:string;
  sourceExampleId?:string;
}
export interface Preview {
  id:string;revision:number;
  /** Exact masked copy that the model will receive. */
  fields:DraftFields;
  maskedCount:number;
  /** Danger policy hit; bot shows the agreed support text instead of normal flow. */
  safety:'none'|'danger';
}

export interface ExampleSituation {id:string;title:string;message:string;relationship:string;context:string;contextType:ContextType}

// --- Proposed result extensions (optional until contracts adopt them).
export type EvidenceLevel='text'|'context'|'insufficient';
export type AnalysisOutput=Omit<OutputFor<'analysis'>,'interpretations'>&{
  interpretations:(OutputFor<'analysis'>['interpretations'][number]&{evidenceLevel?:EvidenceLevel})[];
  comparison?:{matches:string[];alternatives:string[];toClarify:string[]};
};
export type PhraseTone='risky'|'caution'|'good';
export type ReplyFeedbackOutput=Omit<OutputFor<'reply_feedback'>,'phraseFeedback'>&{phraseFeedback:(OutputFor<'reply_feedback'>['phraseFeedback'][number]&{tone?:PhraseTone;why?:string;softer?:string})[]};

/** PROPOSAL: «Сказать прямо» DTO is not in contracts 0.1.0 yet. */
export interface DirectOutput {variants:{text:string;explanation:string}[];preserved:string;attemptFeedback:string|null}
export type DirectRun={id:string;sessionId:string;revision:number;kind:'direct';status:'pending'|'succeeded'|'failed';output:DirectOutput|null;errorCode:string|null};
export type BotRun=z.infer<typeof Run>|DirectRun;

export interface Accepted extends z.infer<typeof RunAccepted> {
  /** Position in the bounded GPU queue; 0 = generating now. Absent if unknown. */
  queuePosition?:number;
}
export interface Delivery {id:string;user:UserContext;run:BotRun}

export type StageEvent='understand_started'|'understand_confirmed'|'direct_started'|'direct_confirmed'|'reply_started'|'exercise_started'|'roleplay_started'|'flow_cancelled'|'example_selected'|'technical_error';

export interface BotDomain {
  // Inbox: false when update_id was already accepted (Telegram redelivery).
  acceptUpdate(updateId:number,user:UserContext):Promise<boolean>;
  completeUpdate(updateId:number):Promise<void>;

  // Account and email verification.
  startAccount(user:UserContext):Promise<Account>;
  account(user:UserContext):Promise<Account>;
  completeOnboarding(user:UserContext):Promise<Account>;
  requestEmailCode(user:UserContext,email:string):Promise<Account>;
  resendEmailCode(user:UserContext):Promise<Account>;
  verifyEmailCode(user:UserContext,code:string):Promise<CodeResult>;
  deleteLearningData(user:UserContext):Promise<void>;
  deleteAccount(user:UserContext):Promise<void>;

  // Persistent dialog state (FSM). expectedVersion mismatch → STATE_CONFLICT.
  state(user:UserContext):Promise<DialogState>;
  setState(user:UserContext,name:string,payload:Record<string,unknown>,expectedVersion:number):Promise<DialogState>;

  // Preview → confirm exact revision → only then AI. Editing creates a new revision.
  preview(user:UserContext,fields:DraftFields):Promise<Preview>;
  examples():Promise<ExampleSituation[]>;

  // Owned sessions.
  createSession(user:UserContext,previewId:string,previewRevision:number,difficulty:Difficulty|null,key:string):Promise<z.infer<typeof Session>>;
  sessions(user:UserContext,query:{cursor?:string;limit:number;contextType?:ContextType}):Promise<z.infer<typeof SessionPage>>;
  session(user:UserContext,id:string):Promise<z.infer<typeof SessionDetail>>;
  deleteSession(user:UserContext,id:string):Promise<void>;

  // Runs: return immediately; results arrive through claimDeliveries. Each takes a confirmed preview where text goes to the model.
  analyze(user:UserContext,sessionId:string,expectedRevision:number,key:string):Promise<Accepted>;
  replyFeedback(user:UserContext,sessionId:string,expectedRevision:number,previewId:string,previewRevision:number,key:string):Promise<Accepted>;
  replyExamples(user:UserContext,sessionId:string,expectedRevision:number,key:string):Promise<Accepted>;
  exercise(user:UserContext,sessionId:string,expectedRevision:number,key:string):Promise<Accepted>;
  exerciseFeedback(user:UserContext,sessionId:string,expectedRevision:number,exerciseRunId:string,previewId:string,previewRevision:number,key:string):Promise<Accepted>;
  roleplayStart(user:UserContext,sessionId:string,expectedRevision:number,difficulty:Difficulty,key:string):Promise<Accepted>;
  roleplayTurn(user:UserContext,roleplayId:string,expectedRevision:number,previewId:string,previewRevision:number,key:string):Promise<Accepted>;
  roleplayFinish(user:UserContext,roleplayId:string,expectedRevision:number,key:string):Promise<Accepted>;
  retry(user:UserContext,runId:string,expectedRevision:number,key:string):Promise<Accepted>;
  direct(user:UserContext,previewId:string,previewRevision:number,key:string):Promise<Accepted>;
  run(user:UserContext,id:string):Promise<BotRun>;
  progress(user:UserContext):Promise<z.infer<typeof Progress>>;

  /** Owner upsert; double click does not add a second vote. */
  rateRun(user:UserContext,runId:string,value:'useful'|'not_useful'):Promise<void>;
  /** Allowlisted stage events only; never text or raw updates. */
  track(user:UserContext,event:StageEvent):Promise<void>;

  // Delivery outbox: finished runs not yet sent. Mark after Telegram accepted the message.
  claimDeliveries(limit:number):Promise<Delivery[]>;
  markDelivered(id:string):Promise<void>;
  /** User blocked the bot or chat is gone: stop retrying this delivery. */
  markUndeliverable(id:string):Promise<void>;
}

export type DomainErrorCode=z.infer<typeof ErrorCode>|'STATE_CONFLICT'|'EMAIL_NOT_VERIFIED'|'EMAIL_INVALID'|'MODEL_UNAVAILABLE'|'PREVIEW_STALE';
export class DomainError extends Error {
  constructor(public code:DomainErrorCode,message:string=code,public retryAfterSeconds?:number) {super(message);}
}
export const isDomainError=(error:unknown,code?:DomainErrorCode):error is DomainError=>error instanceof DomainError&&(!code||error.code===code);
