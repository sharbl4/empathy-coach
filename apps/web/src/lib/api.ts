import type {z} from 'zod';
import {ProductError,authApi,webApi} from '@between/contracts/http';

type Route={method:'GET'|'POST'|'PATCH'|'DELETE';path:string;input:z.ZodType;response:z.ZodType};
export type WebName=keyof typeof webApi;
export type AuthName=keyof typeof authApi;
export type In<R extends Route>=z.input<R['input']>;
export type Out<R extends Route>=z.infer<R['response']>;

/** Safe error: code from the ProductError envelope or NETWORK. Never carries body, URL or cookies. */
export class ApiError extends Error {
  constructor(public code:string,public status:number,public retryAfterSeconds?:number) {super(code);}
}
export const isApiError=(error:unknown,code?:string):error is ApiError=>error instanceof ApiError&&(!code||error.code===code);
export const newKey=()=>crypto.randomUUID();

let csrfToken='';
export const setCsrf=(token:string)=>{csrfToken=token;};
let onUnauthorized:()=>void=()=>{};
export const setUnauthorizedHandler=(handler:()=>void)=>{onUnauthorized=handler;};

async function send(route:Route,input:unknown,options:{key?:string;signal?:AbortSignal}) {
  const parsed=route.input.parse(input) as Record<string,unknown>;
  const rest={...parsed};
  // Path params come from the validated input and are removed from body/query; the server rejects collisions.
  const path=route.path.replace(/:([A-Za-z]+)/g,(_,name:string)=>{const value=rest[name];delete rest[name];return encodeURIComponent(String(value));});
  const write=route.method!=='GET';
  const query=write?'':new URLSearchParams(Object.entries(rest).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString();
  const headers:Record<string,string>={accept:'application/json'};
  if(write){headers['content-type']='application/json';headers['x-csrf-token']=csrfToken;headers['idempotency-key']=options.key??newKey();}
  const init:RequestInit={method:route.method,headers,credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',...(write?{body:JSON.stringify(rest)}:{}),...(options.signal?{signal:options.signal}:{})};
  let response:Response;
  try{response=await fetch(query?`${path}?${query}`:path,init);}
  catch(error){
    if(options.signal?.aborted)throw error;
    // One network retry with the same Idempotency-Key: the server returns the prior result for the same intent.
    if(!write)throw new ApiError('NETWORK',0);
    await new Promise(resolve=>setTimeout(resolve,1000));
    try{response=await fetch(query?`${path}?${query}`:path,init);}catch{throw new ApiError('NETWORK',0);}
  }
  const body:unknown=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok){
    const failure=ProductError.safeParse(body);
    const code=failure.success?failure.data.error.code:response.status===401?'UNAUTHORIZED':'INTERNAL_ERROR';
    if(code==='UNAUTHORIZED')onUnauthorized();
    throw new ApiError(code,response.status,failure.success?failure.data.error.retryAfterSeconds:undefined);
  }
  return route.response.parse(body);
}

export function api<K extends WebName>(name:K,input:In<(typeof webApi)[K]>,options:{key?:string;signal?:AbortSignal}={}):Promise<Out<(typeof webApi)[K]>> {
  return send(webApi[name] as Route,input,options) as Promise<Out<(typeof webApi)[K]>>;
}
export function auth<K extends AuthName>(name:K,input:In<(typeof authApi)[K]>,options:{key?:string;signal?:AbortSignal}={}):Promise<Out<(typeof authApi)[K]>> {
  return send(authApi[name] as Route,input,options) as Promise<Out<(typeof authApi)[K]>>;
}

const messages:Record<string,string>={
  NETWORK:'Нет связи с сервером. Введённое сохранено на странице — попробуйте ещё раз.',
  UNAUTHORIZED:'Сессия закончилась. Войдите снова через бота.',
  CSRF_FAILED:'Страница устарела. Обновите её и повторите.',ORIGIN_FORBIDDEN:'Запрос отклонён: откройте сайт по основному адресу.',
  CONSENT_REQUIRED:'Нужно согласие на обработку данных (см. «Настройки»).',EMAIL_NOT_VERIFIED:'Сначала подтвердите почту в боте.',
  NOT_FOUND:'Запись не найдена или удалена.',REVISION_CONFLICT:'Данные изменились в другом окне или в боте. Обновите страницу, чтобы увидеть актуальную версию.',
  PREVIEW_STALE:'Предпросмотр устарел — данные или модель изменились. Создайте новый.',PREVIEW_NOT_CONFIRMED:'Сначала подтвердите предпросмотр.',
  INPUT_TOO_LARGE:'Текст не помещается в контекст модели. Сократите его — молча обрезать не будем.',
  IDEMPOTENCY_CONFLICT:'Это действие уже выполнено с другими данными. Обновите страницу.',OPERATION_IN_PROGRESS:'Предыдущий запрос ещё выполняется.',
  RATE_LIMITED:'Слишком много запросов. Подождите немного.',LINK_EXPIRED:'Ссылка для входа истекла. Получите новую в боте.',
  LINK_ALREADY_USED:'Ссылка уже использована. Получите новую в боте.',ACCOUNT_CONFLICT:'В этом браузере уже выполнен вход в другой аккаунт. Выйдите и повторите.',
  ASSESSMENT_NOT_DUE:'Повторный тест пока недоступен.',DEPENDENCY_UNAVAILABLE:'Сервис временно недоступен. История и настройки должны работать — попробуйте позже.',
  VALIDATION_ERROR:'Проверьте введённые данные.',INTERNAL_ERROR:'Внутренняя ошибка. Попробуйте ещё раз.'
};
export function errorText(error:unknown) {
  if(error instanceof ApiError){const base=messages[error.code]??messages.INTERNAL_ERROR!;return error.retryAfterSeconds?`${base} Через ${error.retryAfterSeconds} с.`:base;}
  if(error&&typeof error==='object'&&'issues' in error)return messages.VALIDATION_ERROR!;
  return messages.INTERNAL_ERROR!;
}
