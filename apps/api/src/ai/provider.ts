import type { OutputFor, SessionInput } from '@between/contracts';
export const PROMPT_VERSION='analysis-v1';
export interface AiProvider { analyze(input:SessionInput,signal:AbortSignal):Promise<OutputFor<'analysis'>>; }
export class ModelError extends Error {
  constructor(public code:'MODEL_TIMEOUT'|'MODEL_UNAVAILABLE'|'MODEL_INVALID_OUTPUT'|'MODEL_REFUSED'|'CONFIGURATION_ERROR') {super(code);}
}
