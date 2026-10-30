import {evalCases,assessEval} from './evals.js';
import {configuredProvider} from './gigachat.js';
import {ModelError} from './provider.js';
// Never invokes a paid API by default. --live is a separate, explicit manual step.
if(!process.argv.includes('--live')){
  console.info('Offline evaluation catalogue; no model calls. --live makes up to 12 generations, without retries.');
  for(const scenario of evalCases)console.info(`${scenario.id}: ${scenario.criteria.join('; ')}`);
}else{
  const provider=configuredProvider();let passed=0;
  for(const scenario of evalCases){
    try {
      const analysis=await provider.analyze(scenario.input,AbortSignal.timeout(30000));
      const reply=scenario.draft===undefined?undefined:await provider.replyFeedback({session:scenario.input,analysis,draft:scenario.draft},AbortSignal.timeout(30000));
      assessEval(scenario,analysis,reply);passed++;
      console.info(`${scenario.id}: schema/evidence passed; semantic criteria require human review`);
    }catch(error){console.error(`${scenario.id}: ${error instanceof ModelError?error.code:'VALIDATION_FAILED'}; no retry`);process.exitCode=1;}
  }
  console.info(`Structural checks: ${passed}/${evalCases.length}; no correspondence or model content printed`);
}
