import {outputs,validateAnalysisEvidence,validateReplyEvidence,type OutputFor,type Run} from '@between/contracts';
import {type AiProvider,type LearningContext,type ReplyContext,type ExerciseContext,type RoleplayContext,ModelError} from './provider.js';
import type {SessionInput} from '@between/contracts';
import {SayDirectOutput,type DomainRun,type SayDirectRequest} from '@between/contracts/domain';

export type Kind=DomainRun['kind'];
// Internal persisted server snapshots; no client-provided context/history is accepted.
export type Task =
  | {kind:'analysis';context:SessionInput}
  | {kind:'reply_feedback';context:ReplyContext}
  | {kind:'reply_examples'|'exercise';context:LearningContext}
  | {kind:'exercise_feedback';context:ExerciseContext}
  | {kind:'roleplay_start'|'roleplay_turn'|'roleplay_feedback';context:RoleplayContext;roleplayId:string};
export type DomainTask=Task|{kind:'say_direct';context:{session:SessionInput;request:ReturnType<typeof SayDirectRequest.parse>}};
export type TaskOutput=OutputFor<Run['kind']>|ReturnType<typeof SayDirectOutput.parse>;
export function validateTask(task:DomainTask,value:unknown):TaskOutput {
  try {
    if(task.kind==='analysis')return validateAnalysisEvidence(value,task.context.situation.message);
    if(task.kind==='say_direct')return SayDirectOutput.parse(value);
    if(task.kind==='reply_feedback')return validateReplyEvidence(value,task.context.draft);
    if(task.kind==='roleplay_turn')return task.context.turnCount===3?outputs.roleplay_feedback.parse(value):outputs.roleplay_start.parse(value);
    return outputs[task.kind].parse(value);
  }catch{throw new ModelError('MODEL_INVALID_OUTPUT');}
}
export async function invokeTask(provider:AiProvider,task:DomainTask,signal:AbortSignal):Promise<TaskOutput> {
  switch(task.kind){
    case 'analysis':return provider.analyze(task.context,signal);
    case 'say_direct':if(provider.sayDirect)return provider.sayDirect(task.context,signal);break;
    case 'reply_feedback':if(provider.replyFeedback)return provider.replyFeedback(task.context,signal);break;
    case 'reply_examples':if(provider.replyExamples)return provider.replyExamples(task.context,signal);break;
    case 'exercise':if(provider.exercise)return provider.exercise(task.context,signal);break;
    case 'exercise_feedback':if(provider.exerciseFeedback)return provider.exerciseFeedback(task.context,signal);break;
    case 'roleplay_start':if(provider.roleplayStart)return provider.roleplayStart(task.context,signal);break;
    case 'roleplay_turn':if(provider.roleplayTurn)return provider.roleplayTurn(task.context,signal);break;
    case 'roleplay_feedback':if(provider.roleplayFinish)return provider.roleplayFinish(task.context,signal);break;
  }
  throw new ModelError('CONFIGURATION_ERROR');
}
