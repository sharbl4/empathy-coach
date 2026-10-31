import type { OutputFor, SessionInput, ResponseFor } from '@between/contracts';
import type {SayDirectRequest,SayDirectOutput} from '@between/contracts/domain';
export const PROMPT_VERSION='analysis-v1';
export interface LearningContext {session:SessionInput;analysis:OutputFor<'analysis'>;}
export interface ReplyContext extends LearningContext {draft:string;}
export interface ExerciseContext extends LearningContext {exercise:OutputFor<'exercise'>;exerciseRunId:string;answer:string;}
export interface RoleplayContext extends LearningContext {
  messages:ResponseFor<'session'>['roleplays'][number]['messages'];turnCount:number;
}
export interface AiProvider {
  analyze(input:SessionInput,signal:AbortSignal):Promise<OutputFor<'analysis'>>;
  replyFeedback?(input:ReplyContext,signal:AbortSignal):Promise<OutputFor<'reply_feedback'>>;
  replyExamples?(input:LearningContext,signal:AbortSignal):Promise<OutputFor<'reply_examples'>>;
  exercise?(input:LearningContext,signal:AbortSignal):Promise<OutputFor<'exercise'>>;
  exerciseFeedback?(input:ExerciseContext,signal:AbortSignal):Promise<OutputFor<'exercise_feedback'>>;
  roleplayStart?(input:RoleplayContext,signal:AbortSignal):Promise<OutputFor<'roleplay_start'>>;
  roleplayTurn?(input:RoleplayContext,signal:AbortSignal):Promise<OutputFor<'roleplay_turn'>>;
  roleplayFinish?(input:RoleplayContext,signal:AbortSignal):Promise<OutputFor<'roleplay_feedback'>>;
  sayDirect?(input:{session:SessionInput;request:ReturnType<typeof SayDirectRequest.parse>},signal:AbortSignal):Promise<ReturnType<typeof SayDirectOutput.parse>>;
}
export class ModelError extends Error {
  constructor(public code:'MODEL_TIMEOUT'|'MODEL_UNAVAILABLE'|'MODEL_INVALID_OUTPUT'|'MODEL_REFUSED'|'CONFIGURATION_ERROR') {super(code);}
}
