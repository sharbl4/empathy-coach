import type { ApiError, Run } from '@between/contracts';

type ErrorCode = ApiError['error']['code'];
export type RunErrorCode = Extract<Run, { status: 'failed' }>['errorCode'];
export type FailureKind = 'http' | 'network' | 'timeout' | 'invalid-response' | 'invalid-request' | 'aborted';

const codeMessages: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Проверьте заполненные поля.',
  UNAUTHORIZED: 'Сеанс входа закончился. Войдите снова — введённый текст сохранится в этой вкладке.',
  NOT_FOUND: 'Разбор не найден. Возможно, он удалён.',
  REVISION_CONFLICT: 'Данные изменились в другой вкладке. Обновите страницу, чтобы увидеть актуальную версию.',
  OPERATION_IN_PROGRESS: 'Предыдущая операция ещё выполняется. Дождитесь её завершения.',
  IDEMPOTENCY_CONFLICT: 'Запрос изменился во время повтора. Отправьте его ещё раз.',
  RATE_LIMITED: 'Слишком много запросов. Подождите немного и повторите.',
  DEPENDENCY_UNAVAILABLE: 'Сервис временно недоступен. Повторите чуть позже.',
  INTERNAL_ERROR: 'Ошибка на сервере. Повторите позже.',
};

const kindMessages: Record<Exclude<FailureKind, 'http'>, string> = {
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  timeout: 'Сервер долго не отвечает. Повторите запрос.',
  'invalid-response': 'Сервер вернул неожиданный ответ. Повторите позже.',
  'invalid-request': 'Проверьте заполненные поля.',
  aborted: 'Запрос отменён.',
};

export class ApiFailure extends Error {
  constructor(
    public kind: FailureKind,
    public status?: number,
    public code?: ErrorCode,
    public requestId?: string,
    message?: string,
  ) {
    super(message ?? (code ? codeMessages[code] : kind === 'http' ? codeMessages.INTERNAL_ERROR : kindMessages[kind]));
  }
  /** Safe to resend with the same Idempotency-Key: the server may not have seen the request. */
  get retryable() { return this.kind === 'network' || this.kind === 'timeout' || this.code === 'DEPENDENCY_UNAVAILABLE' || this.code === 'RATE_LIMITED' || this.code === 'INTERNAL_ERROR'; }
}

export function isAbort(error: unknown) { return error instanceof ApiFailure && error.kind === 'aborted'; }

export function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) return error.message;
  return 'Что-то пошло не так. Повторите действие.';
}

export const runErrorMessages: Record<RunErrorCode, string> = {
  RUN_INTERRUPTED: 'Разбор прервался из-за перезапуска сервера.',
  MODEL_TIMEOUT: 'Модель не ответила вовремя.',
  MODEL_UNAVAILABLE: 'Модель сейчас недоступна.',
  MODEL_INVALID_OUTPUT: 'Модель вернула ответ в неверном формате.',
  MODEL_REFUSED: 'Модель отказалась разбирать это сообщение.',
  CONFIGURATION_ERROR: 'Сервер не настроен для работы с моделью.',
};
