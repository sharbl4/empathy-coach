import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DomainError,DomainFailure,normalizeDomainError,domainRetryPolicy,EmailVerificationStatus,EmailVerificationResult,ResendEmailCode,operations,Preview,StartRun,SECTION7_CAPABILITIES,UpdateReceiptV2,webCookiePolicy} from '../src/product.js';
import {authApi,authBindings,IdempotencyRequestHeaders,webApi} from '../src/http.js';
import {productAccount,previewFixture} from '../src/product-fixtures.js';
import {id} from '../src/fixtures.js';

test('email recovery exposes durable challenge state and masked address, never a code or plain address',()=>{
  const challenge={challengeId:id,state:'sent',maskedEmail:'a***@example.invalid',expiresAt:'2026-11-01T00:10:00.000Z',resendAfter:'2026-11-01T00:01:00.000Z',attemptsRemaining:5};
  EmailVerificationStatus.parse({state:'challenge',challenge});
  for(const changed of [{maskedEmail:'alice@example.invalid'},{code:'123456'},{attemptsRemaining:6}])assert.equal(EmailVerificationStatus.safeParse({state:'challenge',challenge:{...challenge,...changed}}).success,false);
  assert.equal(ResendEmailCode.safeParse({}).success,false);
  assert.equal(ResendEmailCode.safeParse({challengeId:id,ownerId:id}).success,false);
  EmailVerificationResult.parse({account:productAccount,verification:{state:'verified'}});
  assert.equal(EmailVerificationResult.safeParse({account:productAccount,verification:{state:'none'}}).success,false);
  assert.equal(webApi.emailVerification.method,'GET');assert.equal(webApi.resendEmailCode.method,'POST');
});

test('DomainError keeps only the agreed safe payload and unknown errors are terminal',()=>{
  const error=new DomainError({code:'RATE_LIMITED',requestId:'safe-id',retryAfterSeconds:30});
  assert.deepEqual(DomainFailure.parse(error.toJSON()),{code:'RATE_LIMITED',requestId:'safe-id',retryAfterSeconds:30});
  assert.equal(domainRetryPolicy(error,'idempotent_mutation').maxAttempts,3);
  assert.equal(domainRetryPolicy(error,'generation').retryable,false);
  for(const unknown of [new Error('private details'),{code:'SOME_NEW_CODE'},Object.defineProperty({},'code',{get(){throw new Error('private details');}})]){
    assert.deepEqual(normalizeDomainError(unknown,'safe-id'),{code:'INTERNAL_ERROR',requestId:'safe-id'});
    assert.equal(domainRetryPolicy(unknown,'read').retryable,false);
    assert.ok(!JSON.stringify(normalizeDomainError(unknown,'safe-id')).includes('private details'));
  }
  const failure=new DomainError({code:'INTERNAL_ERROR',requestId:'safe-id'});assert.equal(domainRetryPolicy(failure,'read').retryable,false);
});

test('durable failed inbox receipt survives bounded attempts without becoming a successful mutation',()=>{
  const receipt={updateId:'123',intentKey:id,status:'failed',attempts:3,nextAttemptAt:null,failure:{code:'INTERNAL_ERROR',requestId:'safe-id'}};
  UpdateReceiptV2.parse(receipt);
  for(const changed of [{attempts:4},{status:'completed'},{nextAttemptAt:'2026-11-01T00:00:00.000Z'}])assert.equal(UpdateReceiptV2.safeParse({...receipt,...changed}).success,false);
});

test('preview binds template/dependencies and ordered source fields; a run carries the confirmed hash',()=>{
  Preview.parse(previewFixture);
  assert.equal(Preview.safeParse({...previewFixture,templateHash:undefined}).success,false);
  assert.equal(Preview.safeParse({...previewFixture,fields:[...previewFixture.fields,...previewFixture.fields]}).success,false);
  assert.equal(Preview.safeParse({...previewFixture,turns:[{fieldId:id,speaker:'self',order:1}]}).success,false);
  const input={previewId:id,previewRevision:1,expectedSessionRevision:1,snapshotHash:previewFixture.snapshotHash};
  StartRun.parse(input);assert.equal(StartRun.safeParse({...input,snapshotHash:undefined}).success,false);
});

test('auth exchange/logout/revoke all have required browser security and server-only cookie policy',()=>{
  assert.deepEqual(Object.keys(authBindings).sort(),Object.keys(authApi).sort());
  for(const name of ['redeemWebLink','logout','revokeSession','revokeAllSessions'] as const)assert.equal(authBindings[name].mutation,true);
  const headers={'idempotency-key':id,'x-csrf-token':'a'.repeat(32)};
  assert.equal(IdempotencyRequestHeaders.safeParse(headers).success,false);
  IdempotencyRequestHeaders.parse({...headers,origin:'https://example.invalid'});
  assert.equal(webCookiePolicy('production').secure,true);assert.equal(webCookiePolicy('production').httpOnly,true);
  assert.equal(webCookiePolicy('production').sessionName.startsWith('__Host-'),true);
  assert.notEqual(webCookiePolicy('test').sessionName,webCookiePolicy('production').sessionName);
});

test('all 27 mandatory section7 features retain shared facade bindings',()=>{
  const features=readFileSync('docs/product.md','utf8').split('\n').filter(line=>line.startsWith('| ')).slice(1).map(line=>line.split('|')[1].trim());
  assert.equal(SECTION7_CAPABILITIES.length,27);assert.deepEqual(SECTION7_CAPABILITIES.map(item=>item.feature),features);
  for(const feature of SECTION7_CAPABILITIES)for(const method of feature.operations)assert.ok(operations[method]);
});
