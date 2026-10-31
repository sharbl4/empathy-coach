// Never print raw errors/call logs: they can contain auth-fragment URLs or cookies.
export default class SafeReporter{
  onTestEnd(test,result){console.log('Browser scenario: '+test.title+': '+result.status);if(result.status!=='passed'){const stack=result.error?.stack??'';const source=stack.match(/(?:interfaces|shared-account)\.spec\.ts:\d+:\d+/)?.[0];console.log('Browser failure location: '+(source??`${test.location.line}:${test.location.column}`)+'; raw error and auth URLs suppressed.');}}
  onEnd(result){console.log('Browser gate: '+result.status+'; raw errors, attachments and call logs suppressed.');}
}
