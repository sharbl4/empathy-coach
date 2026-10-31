import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import Fastify,{type FastifyRequest,type FastifyReply} from 'fastify';
import staticFiles from '@fastify/static';
import {authApi,authBindings,webApi,IdempotencyRequestHeaders,HttpErrorStatus,ProductError} from '@between/contracts/http';
import {normalizeDomainError,DomainError,webCookiePolicy,type CreateHttpAdapter,type ProductFacade,type BrowserAccess} from '@between/contracts/product';
import {fail} from '../domain/product/core.js';
function assemble(request:FastifyRequest){const result:Record<string,unknown>={};for(const part of [request.params,request.query,request.body]){if(part===undefined||part===null)continue;if(typeof part!=='object'||Array.isArray(part))fail('VALIDATION_ERROR');for(const [k,v] of Object.entries(part)){if(Object.hasOwn(result,k))fail('VALIDATION_ERROR');result[k]=v;}}return result;}
function cookies(request:FastifyRequest){const result:Record<string,string>={};for(const part of (request.headers.cookie??'').split(';')){const separator=part.indexOf('=');if(separator<0)continue;const name=part.slice(0,separator).trim();if(Object.hasOwn(result,name))fail('UNAUTHORIZED');result[name]=part.slice(separator+1).trim();}return result;}
export const buildHttpAdapter=async(options:Parameters<CreateHttpAdapter>[0],testIssue?:(account:'A'|'B')=>Promise<unknown>)=>{
  if(options.trustedProxyIPs.some(ip=>isIP(ip)!==4))fail('VALIDATION_ERROR');const configured=new URL(options.origin);if(configured.origin!==options.origin||(options.environment==='production'&&configured.protocol!=='https:'))fail('VALIDATION_ERROR');
  const app=Fastify({logger:false,trustProxy:options.trustedProxyIPs.length?options.trustedProxyIPs:false,bodyLimit:131072,genReqId:()=>randomUUID(),requestTimeout:15000});const policy=webCookiePolicy(options.environment);let listening=false,listenPromise:Promise<void>|undefined,closePromise:Promise<void>|undefined;
  const setCookie=(reply:FastifyReply,name:string,value:string,clear=false)=>{const cookie=`${name}=${value}; HttpOnly; Path=/; SameSite=${policy.sameSite}; Max-Age=${clear?0:policy.sessionMaxAgeSeconds}${policy.secure?'; Secure':''}`;const previous=reply.getHeader('set-cookie');reply.header('set-cookie',[...(Array.isArray(previous)?previous:previous?[String(previous)]:[]),cookie]);};
  const browser=async(request:FastifyRequest,reply:FastifyReply):Promise<BrowserAccess>=>{const jar=cookies(request),access=await options.domain.openBrowser(jar[policy.bindingName],jar[policy.sessionName]);if(access.setBindingCookie)setCookie(reply,policy.bindingName,access.setBindingCookie);return access;};
  const proof=async(request:FastifyRequest,access:BrowserAccess)=>{const h=IdempotencyRequestHeaders.safeParse(request.headers);if(!h.success){if(request.headers.origin!==options.origin)fail('ORIGIN_FORBIDDEN');if(!request.headers['x-csrf-token'])fail('CSRF_FAILED');fail('VALIDATION_ERROR');}await options.domain.authorizeWebMutation(access.context,{origin:h.data.origin,csrfToken:h.data['x-csrf-token']});return h.data['idempotency-key'];};
  const context=async(request:FastifyRequest)=>{const token=cookies(request)[policy.sessionName];if(!token)fail('UNAUTHORIZED');return options.domain.resolveWebSession(token);};
  app.addHook('onRequest',async(_request,reply)=>{reply.header('cache-control','no-store').header('referrer-policy','no-referrer').header('x-content-type-options','nosniff').header('x-frame-options','DENY');});
  app.setErrorHandler((error,request,reply)=>{let safe:unknown=error;if(error instanceof Error&&('validation' in error||('code' in error&&['FST_ERR_CTP_INVALID_JSON_BODY','FST_ERR_CTP_BODY_TOO_LARGE'].includes(String(error.code)))))safe=new DomainError({code:'VALIDATION_ERROR',requestId:request.id});const failure=normalizeDomainError(safe,request.id);if(failure.retryAfterSeconds!==undefined)reply.header('retry-after',failure.retryAfterSeconds);void reply.code(HttpErrorStatus[failure.code]).send(ProductError.parse({error:failure}));});
  for(const route of Object.values(webApi))app.route({method:route.method,url:route.path,handler:async(request,reply)=>{const input=route.input.safeParse(assemble(request));if(!input.success)fail('VALIDATION_ERROR');let key:string|undefined;if(route.mutable)key=await proof(request,await browser(request,reply));const ctx=await context(request);const method=options.domain[route.operation];const result=await Reflect.apply(method,options.domain,[ctx,input.data,...route.mutable?[key]:[]]);const output=route.response.safeParse(result);if(!output.success)fail('INTERNAL_ERROR');if(route.operation==='deleteAccount')setCookie(reply,policy.sessionName,'',true);return reply.send(output.data);}});
  for(const [name,route] of Object.entries(authApi))app.route({method:route.method,url:route.path,handler:async(request,reply)=>{
    const input=route.input.safeParse(assemble(request));if(!input.success)fail('VALIDATION_ERROR');const binding=authBindings[name as keyof typeof authBindings],access=await browser(request,reply);let intent:string|undefined;if(binding.mutation)intent=await proof(request,access);
    let result:unknown=null;
    switch(binding.facade){
      case 'openBrowser':result=access.publicSession;break;
      case 'webEntry':result=await options.domain.webEntry();break;
      case 'redeemWebLink':{const consumed=await options.domain.redeemWebLink(access.context,authApi.redeemWebLink.input.parse(input.data),intent!);setCookie(reply,policy.sessionName,consumed.setSessionCookie);result=consumed.publicSession;break;}
      case 'webSessions':result=await options.domain.webSessions(await context(request),authApi.sessions.input.parse(input.data));break;
      case 'revokeCurrentWebSession':await options.domain.revokeCurrentWebSession(await context(request),intent!);break;
      case 'revokeAllWebSessions':await options.domain.revokeAllWebSessions(await context(request),intent!);break;
      case 'revokeWebSession':{const ctx=await context(request),id=authApi.revokeSession.input.parse(input.data).id;const current=await options.domain.webSessions(ctx,{limit:50});const ownedCurrent=current.items.some(s=>s.id===id&&s.isCurrent);await options.domain.revokeWebSession(ctx,id,intent!);if(ownedCurrent)setCookie(reply,policy.sessionName,'',true);break;}
    }
    if(binding.clearSessionCookie===true)setCookie(reply,policy.sessionName,'',true);const output=route.response.safeParse(result);if(!output.success)fail('INTERNAL_ERROR');return reply.send(output.data);
  }});
  app.get('/api/health/live',async()=>({status:'ok'}));app.get('/api/health/ready',async(_request,reply)=>{const h=await options.domain.health(),ready=listening&&h.database&&h.workers&&h.scheduler&&h.pollerLease;return reply.code(ready?200:503).send({status:ready?'ready':'unavailable'});});
  if(testIssue)app.post('/__test/issue-web-link',async(request)=>{const body=request.body;if(!body||typeof body!=='object'||Object.keys(body).length!==1||!('account' in body)||!['A','B'].includes(String(body.account)))fail('VALIDATION_ERROR');return testIssue(body.account as 'A'|'B');});
  await app.register(staticFiles,{root:resolve(options.webRoot),index:false});app.setNotFoundHandler(async(request,reply)=>{if(request.url.startsWith('/api/')||!['GET','HEAD'].includes(request.method))return reply.code(404).send(ProductError.parse({error:{code:'NOT_FOUND',requestId:request.id}}));return reply.sendFile('index.html');});
  return {listen:()=>listenPromise??(listenPromise=(async()=>{await app.listen({host:options.host,port:options.port});listening=true;})()),close:()=>closePromise??(closePromise=(async()=>{listening=false;await app.close();})()),health:()=>({listening})};
};
export type {ProductFacade};
