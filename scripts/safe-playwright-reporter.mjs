// Never print raw errors/call logs: they can contain auth-fragment URLs or cookies.
export default class SafeReporter{
  onTestEnd(test,result){console.log('Browser scenario: '+test.title+': '+result.status);if(result.status!=='passed'){const stack=result.error?.stack??'';const source=stack.match(/(?:interfaces|shared-account)\.spec\.ts:\d+:\d+/)?.[0];console.log('Browser failure location: '+(source??`${test.location.line}:${test.location.column}`)+'; raw error and auth URLs suppressed.');}}
  onStdOut(chunk){const line=String(chunk);if(/^SAFE_ROLE_STEP [0-9 ]+\r?\n$/.test(line))process.stdout.write(line);}
  onStepEnd(_test,_result,step){if(step.error&&step.location)console.log(`Browser failed step source: ${step.location.line}:${step.location.column}; locator and payload suppressed.`);}
  onEnd(result){console.log('Browser gate: '+result.status+'; raw errors, attachments and call logs suppressed.');}
}
