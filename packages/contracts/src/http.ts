import {z} from 'zod';
import {operations,type Operation,Empty,Id,PublicWebSession,WebLinkStart,WebLink,WebSessionPage,ProductError} from './product.js';
export const IdempotencyRequestHeaders=z.object({'idempotency-key':Id,'x-csrf-token':z.string().min(32).max(200)});
export const WriteHeaders=z.object({'x-csrf-token':z.string().min(32).max(200)});
function route<K extends Operation>(method:'GET'|'POST'|'PATCH'|'DELETE',path:string,operation:K){return {method,path,operation,auth:'server-session' as const,...operations[operation]};}
/** Adapter assembles path/query/body, rejects collisions, validates strict input, then issues ctx from cookie. */
export const webApi={
  account:route('GET','/api/account','account'),updateAccount:route('PATCH','/api/account','updateAccount'),acceptConsent:route('POST','/api/account/consent','acceptConsent'),revokeConsent:route('DELETE','/api/account/consent','revokeConsent'),
  requestEmailCode:route('POST','/api/account/email/challenge','requestEmailCode'),verifyEmailCode:route('POST','/api/account/email/verify','verifyEmailCode'),
  dialogue:route('GET','/api/dialogue','dialogue'),updateDialogue:route('PATCH','/api/dialogue','updateDialogue'),resetDialogue:route('POST','/api/dialogue/reset','resetDialogue'),
  createSession:route('POST','/api/sessions','createSession'),sessions:route('GET','/api/sessions','sessions'),session:route('GET','/api/sessions/:id','session'),updateSession:route('PATCH','/api/sessions/:id','updateSession'),deleteSession:route('DELETE','/api/sessions/:id','deleteSession'),
  deleteData:route('DELETE','/api/account/data','deleteData'),deleteAccount:route('DELETE','/api/account','deleteAccount'),
  createPreview:route('POST','/api/previews','createPreview'),preview:route('GET','/api/previews/:id','preview'),editPreview:route('PATCH','/api/previews/:id','editPreview'),confirmPreview:route('POST','/api/previews/:id/confirm','confirmPreview'),
  startRun:route('POST','/api/runs','startRun'),run:route('GET','/api/runs/:id','run'),retry:route('POST','/api/runs/:id/retry','retry'),
  examples:route('GET','/api/examples','examples'),example:route('GET','/api/examples/:id','example'),
  progress:route('GET','/api/progress','progress'),skillAttempts:route('GET','/api/progress/attempts','skillAttempts'),
  dailyPractice:route('GET','/api/practice/today','dailyPractice'),completeDailyPractice:route('POST','/api/practice/complete','completeDailyPractice'),
  cards:route('GET','/api/cards','cards'),card:route('GET','/api/cards/:id','card'),completeCard:route('POST','/api/cards/:id/complete','completeCard'),
  reminders:route('GET','/api/reminders','reminders'),updateReminders:route('PATCH','/api/reminders','updateReminders'),
  assessment:route('GET','/api/assessments/form','assessment'),submitAssessment:route('POST','/api/assessments/:id/submit','submitAssessment'),assessmentResults:route('GET','/api/assessments/results','assessmentResults'),
  rateRun:route('POST','/api/runs/:runId/rating','rateRun'),recordStage:route('POST','/api/events','recordStage'),support:route('GET','/api/support','support'),
} as const;
export const authApi={
  session:{method:'GET',path:'/api/auth/session',input:Empty,response:PublicWebSession},
  beginWebLink:{method:'POST',path:'/api/auth/web-links',input:Empty,response:WebLinkStart},
  webLinkStatus:{method:'GET',path:'/api/auth/web-links/:id',input:z.strictObject({id:Id}),response:WebLink},
  consumeWebLink:{method:'POST',path:'/api/auth/web-links/:id/consume',input:z.strictObject({id:Id}),response:PublicWebSession},
  logout:{method:'POST',path:'/api/auth/logout',input:Empty,response:z.null()},
  sessions:{method:'GET',path:'/api/auth/sessions',input:Empty,response:WebSessionPage},
  revokeSession:{method:'DELETE',path:'/api/auth/sessions/:id',input:z.strictObject({id:Id}),response:z.null()},
  revokeAllSessions:{method:'DELETE',path:'/api/auth/sessions',input:Empty,response:z.null()},
} as const;
export const HttpErrorStatus={VALIDATION_ERROR:400,UNAUTHORIZED:401,FORBIDDEN:403,CSRF_FAILED:403,ORIGIN_FORBIDDEN:403,EMAIL_NOT_VERIFIED:403,CONSENT_REQUIRED:403,CODE_INVALID:400,CODE_EXPIRED:410,NOT_FOUND:404,REVISION_CONFLICT:409,PREVIEW_STALE:409,PREVIEW_NOT_CONFIRMED:409,INPUT_TOO_LARGE:422,IDEMPOTENCY_CONFLICT:409,OPERATION_IN_PROGRESS:409,RATE_LIMITED:429,LINK_EXPIRED:410,LINK_ALREADY_USED:409,ACCOUNT_CONFLICT:409,ASSESSMENT_NOT_DUE:409,DEPENDENCY_UNAVAILABLE:503,INTERNAL_ERROR:500} as const;
export {ProductError};
