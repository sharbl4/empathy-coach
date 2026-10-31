// Never print raw errors/call logs: they can contain auth-fragment URLs or cookies.
export default class SafeReporter{
  onTestEnd(_test,result){console.log('Browser scenario: '+result.status);}
  onEnd(result){console.log('Browser gate: '+result.status+'; raw errors, attachments and call logs suppressed.');}
}
