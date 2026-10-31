// Auth adapter: Supabase in real use, an in-memory stand-in for labelled dev fixture mode.

export interface AuthUser { id: string; email: string | null; }
export interface AuthState { user: AuthUser | null; /** True while the session is a password-recovery session. */ recovery: boolean; }

export type AuthErrorKind =
  | 'invalid_credentials' | 'email_not_confirmed' | 'weak_password' | 'same_password' | 'rate_limited'
  | 'link_expired' | 'signup_disabled' | 'session_missing' | 'network' | 'not_configured' | 'unknown';

export class AuthFailure extends Error {
  constructor(public kind: AuthErrorKind, message?: string) { super(message ?? authMessages[kind]); }
}

export const authMessages: Record<AuthErrorKind, string> = {
  invalid_credentials: 'Неверный email или пароль.',
  email_not_confirmed: 'Email ещё не подтверждён. Откройте письмо или отправьте его повторно.',
  weak_password: 'Пароль слишком простой. Используйте не меньше 8 символов.',
  same_password: 'Новый пароль совпадает со старым. Придумайте другой.',
  rate_limited: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  link_expired: 'Ссылка устарела или уже использована. Запросите новое письмо.',
  signup_disabled: 'Регистрация сейчас отключена.',
  session_missing: 'Ссылка для восстановления не активна. Запросите новое письмо.',
  network: 'Нет связи с сервисом входа. Проверьте интернет и повторите.',
  not_configured: 'Вход не настроен: не заданы публичные параметры Supabase.',
  unknown: 'Не удалось выполнить действие. Попробуйте ещё раз.',
};

export interface AuthAdapter {
  readonly kind: 'supabase' | 'fixtures';
  /** Resolves after the SDK has processed any auth link in the URL. */
  init(): Promise<AuthState>;
  subscribe(listener: (state: AuthState) => void): () => void;
  accessToken(): Promise<string | null>;
  /** Asks the SDK for a fresh token after a 401. Returns null when the session is gone. */
  refresh(): Promise<string | null>;
  signUp(email: string, password: string): Promise<void>;
  resendSignup(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Dev fixture mode only: stand-ins for clicking the links in confirmation/recovery emails. */
  dev?: { confirmEmail(email: string): Promise<void>; openRecoveryLink(email: string): Promise<void>; };
}
