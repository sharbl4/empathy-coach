import type { ApiError } from '@between/contracts';
export class HttpError extends Error {
  constructor(public statusCode:number, public code:ApiError['error']['code'], message:string) { super(message); }
}
export const unavailable = () => new HttpError(503,'DEPENDENCY_UNAVAILABLE','Сервис временно недоступен');
export const notFound = () => new HttpError(404,'NOT_FOUND','Объект не найден');
