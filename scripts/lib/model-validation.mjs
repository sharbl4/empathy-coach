import {domainOutputs} from '@between/contracts/domain';
import {validateAnalysisEvidence} from '@between/contracts';
export function checkedCompletion(data,kind,message){
  const choice=data?.choices?.[0],reply=choice?.message;
  if(choice?.finish_reason!=='stop'||typeof reply?.content!=='string'||reply.reasoning_content||reply.reasoning||/<\/?think\b/i.test(reply.content)||reply.tool_calls?.length)throw new Error('MODEL_INVALID_OUTPUT');
  const value=JSON.parse(reply.content);
  return kind==='analysis'?validateAnalysisEvidence(value,message):domainOutputs[kind].parse(value);
}
