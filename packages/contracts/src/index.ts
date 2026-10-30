import { z } from 'zod';
export const CONTRACT_VERSION = '0.1.0';
export const Id = z.uuid();
const text = (max=3000) => z.string().trim().min(1).max(max);
const short = text(500);
const list = z.array(short).max(8);
export const Revision = z.number().int().positive();
export const Goal = z.enum(['support','clarify','reconcile','boundary']);
export const Situation = z.strictObject({message:text(6000),relationship:text(200),context:z.string().max(4000),goal:Goal});
export const UserGuess = z.strictObject({emotions:z.array(text(100)).max(3),evidenceQuotes:z.array(text(6000)).max(3),unsure:z.boolean()});
export const SessionInput = z.strictObject({title:text(200),situation:Situation,guess:UserGuess}).superRefine((v,ctx)=>{for(const quote of v.guess.evidenceQuotes)if(!v.situation.message.includes(quote))ctx.addIssue({code:'custom',path:['guess','evidenceQuotes'],message:'Quote must occur in message'});});
export const UpdateSession = SessionInput.safeExtend({expectedRevision:Revision});
export const ExpectedRevision = z.strictObject({expectedRevision:Revision});
export const ReplyRequest = ExpectedRevision.extend({draft:text()});
export const ExerciseAnswer = ExpectedRevision.extend({exerciseRunId:Id,answer:text()});
export const TurnRequest = ExpectedRevision.extend({content:text()});
export const IdempotencyHeaders = z.object({'idempotency-key':Id});
export const Analysis = z.strictObject({literalMeaning:text(),interpretations:z.array(z.strictObject({emotion:short,possibleNeed:short,explanation:text(),evidenceQuotes:z.array(text(6000)).max(6)})).min(2).max(3),uncertainty:text(),clarifyingQuestion:short,guessFeedback:text(),skillTip:short});
export const ReplyOption = z.strictObject({goal:Goal,text:text(),explanation:short});
export const ReplyOptions = z.array(ReplyOption).length(4).refine(v=>new Set(v.map(x=>x.goal)).size===4,'One option per goal');
export const ReplyFeedback = z.strictObject({strengths:list,phraseFeedback:z.array(z.strictObject({quote:text(),possibleImpact:short,suggestion:short})).max(8),revisedReply:text(),options:ReplyOptions});
export const Exercise = z.strictObject({instruction:text(),skill:short,exampleHint:short});
export const ExerciseFeedback = z.strictObject({strengths:list,improvement:text(),suggestedAttempt:text()});
export const RoleplayMessageOutput = z.strictObject({kind:z.literal('message'),content:text()});
export const RoleplayFeedbackOutput = z.strictObject({kind:z.literal('feedback'),strengths:list,improvements:list,nextPractice:short});
export const RoleplayOutput = z.discriminatedUnion('kind',[RoleplayMessageOutput,RoleplayFeedbackOutput]);
export const outputs = {analysis:Analysis,reply_feedback:ReplyFeedback,reply_examples:ReplyOptions,exercise:Exercise,exercise_feedback:ExerciseFeedback,roleplay_start:RoleplayMessageOutput,roleplay_turn:RoleplayOutput,roleplay_feedback:RoleplayFeedbackOutput} as const;
export const RunKind = z.enum(['analysis','reply_feedback','reply_examples','exercise','exercise_feedback','roleplay_start','roleplay_turn','roleplay_feedback']);
export const RunErrorCode = z.enum(['RUN_INTERRUPTED','MODEL_TIMEOUT','MODEL_UNAVAILABLE','MODEL_INVALID_OUTPUT','MODEL_REFUSED','CONFIGURATION_ERROR']);
const runBase={id:Id,sessionId:Id,revision:Revision,createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()};
function runFor<K extends keyof typeof outputs>(kind: K) { return z.discriminatedUnion('status',[
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('pending'),output:z.null(),errorCode:z.null()}),
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('failed'),output:z.null(),errorCode:RunErrorCode}),
  z.strictObject({...runBase,kind:z.literal(kind),status:z.literal('succeeded'),output:outputs[kind],errorCode:z.null()})
]); }
export const Run = z.union([runFor('analysis'),runFor('reply_feedback'),runFor('reply_examples'),runFor('exercise'),runFor('exercise_feedback'),runFor('roleplay_start'),runFor('roleplay_turn'),runFor('roleplay_feedback')]);
export const RunAccepted = z.strictObject({runId:Id,resourceId:Id.optional()});
export const Roleplay = z.strictObject({id:Id,sessionId:Id,revision:Revision,status:z.enum(['active','completed']),turnCount:z.number().int().min(0).max(3),messages:z.array(z.strictObject({id:Id,sequence:z.number().int().nonnegative(),role:z.enum(['user','assistant']),content:text()})).max(7),feedback:RoleplayFeedbackOutput.nullable()});
export const Session = z.strictObject({id:Id,title:text(200),situation:Situation,guess:UserGuess,revision:Revision,createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()});
export const SessionDetail = Session.extend({runs:z.array(Run).max(1000),roleplays:z.array(Roleplay).max(100)});
export const SessionQuery = z.strictObject({cursor:z.string().min(1).max(500).optional(),limit:z.coerce.number().int().min(1).max(50).default(20),q:z.string().max(200).optional()});
export const SessionPage = z.strictObject({items:z.array(Session).max(50),nextCursor:z.string().max(500).nullable()});
export const Me = z.strictObject({id:Id,displayName:text(100),onboardingCompletedAt:z.iso.datetime().nullable(),aiMode:z.enum(['gigachat','mock']),capabilities:z.strictObject({analysis:z.boolean(),reply:z.boolean(),exercise:z.boolean(),roleplay:z.boolean()})});
export const UpdateMe = z.strictObject({displayName:text(100).optional(),onboardingCompleted:z.literal(true).optional()}).refine(v=>Object.keys(v).length>0);
export const DeleteData = z.strictObject({confirmation:z.literal('DELETE_MY_LEARNING_DATA')});
export const Progress = z.strictObject({analyzedSessions:z.number().int().nonnegative(),completedExercises:z.number().int().nonnegative(),completedRoleplays:z.number().int().nonnegative(),skills:z.array(z.strictObject({skill:short,count:z.number().int().nonnegative()})).max(100),latestTip:short.nullable()});
export const ErrorCode = z.enum(['VALIDATION_ERROR','UNAUTHORIZED','NOT_FOUND','REVISION_CONFLICT','OPERATION_IN_PROGRESS','IDEMPOTENCY_CONFLICT','RATE_LIMITED','DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR']);
export const ApiError = z.strictObject({error:z.strictObject({code:ErrorCode,message:short,requestId:text(100)})});
export const Health = z.strictObject({status:z.literal('ok')});
export const api = {
  live:{method:'GET',path:'/api/health/live',response:Health},ready:{method:'GET',path:'/api/health/ready',response:Health},
  me:{method:'GET',path:'/api/me',response:Me},updateMe:{method:'PATCH',path:'/api/me',body:UpdateMe,response:Me},deleteData:{method:'DELETE',path:'/api/me/data',body:DeleteData,response:z.null()},
  createSession:{method:'POST',path:'/api/sessions',body:SessionInput,response:Session},sessions:{method:'GET',path:'/api/sessions',query:SessionQuery,response:SessionPage},session:{method:'GET',path:'/api/sessions/:id',response:SessionDetail},updateSession:{method:'PATCH',path:'/api/sessions/:id',body:UpdateSession,response:Session},deleteSession:{method:'DELETE',path:'/api/sessions/:id',response:z.null()},
  analyze:{method:'POST',path:'/api/sessions/:id/analyze',body:ExpectedRevision,response:RunAccepted},replyFeedback:{method:'POST',path:'/api/sessions/:id/reply-feedback',body:ReplyRequest,response:RunAccepted},replyExamples:{method:'POST',path:'/api/sessions/:id/reply-examples',body:ExpectedRevision,response:RunAccepted},exercise:{method:'POST',path:'/api/sessions/:id/exercise',body:ExpectedRevision,response:RunAccepted},exerciseFeedback:{method:'POST',path:'/api/sessions/:id/exercise-feedback',body:ExerciseAnswer,response:RunAccepted},roleplayStart:{method:'POST',path:'/api/sessions/:id/roleplays',body:ExpectedRevision,response:RunAccepted},roleplayTurn:{method:'POST',path:'/api/roleplays/:id/turns',body:TurnRequest,response:RunAccepted},roleplayFinish:{method:'POST',path:'/api/roleplays/:id/finish',body:ExpectedRevision,response:RunAccepted},retry:{method:'POST',path:'/api/runs/:id/retry',body:ExpectedRevision,response:RunAccepted},run:{method:'GET',path:'/api/runs/:id',response:Run},progress:{method:'GET',path:'/api/progress',response:Progress}
} as const;
export type SessionInput = z.infer<typeof SessionInput>;
export type Run = z.infer<typeof Run>;
export type SessionDetail = z.infer<typeof SessionDetail>;
export type ApiError = z.infer<typeof ApiError>;
export type RequestFor<K extends keyof typeof api> = (typeof api)[K] extends {body: infer B extends z.ZodType} ? z.infer<B> : never;
export type ResponseFor<K extends keyof typeof api> = z.infer<(typeof api)[K]['response']>;
export type OutputFor<K extends keyof typeof outputs> = z.infer<(typeof outputs)[K]>;
export function outputJsonSchema<K extends keyof typeof outputs>(kind: K) {return z.toJSONSchema(outputs[kind]);}
export function validateAnalysisEvidence(value: unknown,message: string) {
  const result=Analysis.parse(value);
  if(result.interpretations.some(i=>i.evidenceQuotes.some(q=>!message.includes(q))))throw new Error('Invalid evidence quote');
  return result;
}
export function validateReplyEvidence(value: unknown,draft: string) {
  const result=ReplyFeedback.parse(value);
  if(result.phraseFeedback.some(p=>!draft.includes(p.quote)))throw new Error('Invalid draft quote');
  return result;
}
