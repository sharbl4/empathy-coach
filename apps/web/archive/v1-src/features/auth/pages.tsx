import { useEffect, useState, type FormEvent } from 'react';
import { Link, navigate, safeNext, useLocation } from '../../app/router';
import { useAuth, useServices } from '../../app/context';
import { Button, Notice, TextField } from '../../components/ui';
import { authRedirect } from '../../lib/config';
import { deleteDraft, readDraft, writeDraft } from '../../lib/drafts';
import { authMessages } from '../../lib/auth/types';
import { AuthLayout, PasswordToggle } from './AuthLayout';
import { EMAIL_PATTERN, MIN_PASSWORD, useAuthAction } from './useAuthAction';

// The email typed on one auth screen is carried to the next one in memory, never in the URL.
const EMAIL_KEY = 'auth:email';
const rememberEmail = (email: string) => writeDraft(EMAIL_KEY, email.trim());
const rememberedEmail = () => readDraft<string>(EMAIL_KEY) ?? '';

function validEmail(email: string) { return EMAIL_PATTERN.test(email.trim()) ? null : 'Введите email в формате name@example.com.'; }
function useQuery() { return new URLSearchParams(useLocation().search); }

export function LoginPage() {
  const { auth } = useServices();
  const { expired, clearExpired } = useAuth();
  const query = useQuery();
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAuthAction();
  const emailError = touched ? validEmail(email) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (validEmail(email) || !password) return;
    rememberEmail(email);
    const ok = await run(() => auth.signIn(email.trim(), password));
    if (ok) { clearExpired(); navigate(safeNext(query.get('next')) ?? '/history', { replace: true }); }
  }

  return (
    <AuthLayout title="Вход" footer={<><Link to="/auth/signup">Создать аккаунт</Link><Link to="/auth/forgot">Забыли пароль?</Link></>}>
      {expired && <Notice title="Сеанс входа закончился">Войдите снова. Несохранённый текст остаётся в этой вкладке до перезагрузки.</Notice>}
      {query.get('reset') === 'done' && <Notice tone="success" title="Пароль изменён">Войдите с новым паролем.</Notice>}
      {query.get('signedOut') === '1' && <Notice>Вы вышли из аккаунта.</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={emailError} required />
        <TextField label="Пароль" type={shown ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} error={touched && !password ? 'Введите пароль.' : null} required />
        <PasswordToggle shown={shown} onChange={setShown} />
        {error && (
          <Notice tone="error" action={error.kind === 'email_not_confirmed' ? <Button variant="secondary" onClick={() => navigate('/auth/check-email')}>Отправить письмо ещё раз</Button> : undefined}>
            {error.message}
          </Notice>
        )}
        <Button type="submit" busy={busy}>Войти</Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { auth } = useServices();
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAuthAction();
  const errors = {
    email: validEmail(email),
    password: password.length < MIN_PASSWORD ? `Не меньше ${MIN_PASSWORD} символов.` : null,
    repeat: repeat !== password ? 'Пароли не совпадают.' : null,
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (errors.email || errors.password || errors.repeat) return;
    rememberEmail(email);
    if (await run(() => auth.signUp(email.trim(), password))) navigate('/auth/check-email');
  }

  return (
    <AuthLayout title="Регистрация" footer={<Link to="/auth/login">Уже есть аккаунт? Войти</Link>}>
      <p className="muted">После регистрации придёт письмо со ссылкой для подтверждения email.</p>
      <form onSubmit={submit} noValidate>
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={touched ? errors.email : null} required />
        <TextField label="Пароль" hint={`Минимум ${MIN_PASSWORD} символов.`} type={shown ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={touched ? errors.password : null} required />
        <TextField label="Повторите пароль" type={shown ? 'text' : 'password'} autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} error={touched ? errors.repeat : null} required />
        <PasswordToggle shown={shown} onChange={setShown} />
        {error && <Notice tone="error">{error.message}</Notice>}
        <Button type="submit" busy={busy}>Зарегистрироваться</Button>
      </form>
    </AuthLayout>
  );
}

const RESEND_COOLDOWN = 60;

export function CheckEmailPage() {
  const { auth } = useServices();
  const [email, setEmail] = useState(rememberedEmail);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAuthAction();
  const known = rememberedEmail();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend(event: FormEvent) {
    event.preventDefault();
    if (validEmail(email)) return;
    rememberEmail(email);
    if (await run(() => auth.resendSignup(email.trim()))) { setSent(true); setCooldown(RESEND_COOLDOWN); }
  }

  async function devConfirm() {
    if (await run(() => auth.dev!.confirmEmail(email.trim()))) navigate('/history', { replace: true });
  }

  return (
    <AuthLayout title="Подтвердите email" footer={<Link to="/auth/login">Вернуться ко входу</Link>}>
      <p>{known ? <>Мы отправили письмо на <strong>{known}</strong>.</> : 'Мы отправили письмо со ссылкой.'} Откройте его и перейдите по ссылке — после этого вы попадёте в кабинет.</p>
      <p className="muted">Письма нет несколько минут? Проверьте «Спам» или отправьте снова.</p>
      <form onSubmit={resend} noValidate>
        {!known && <TextField label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} error={email && validEmail(email) ? validEmail(email) : null} />}
        {sent && !error && <Notice tone="success">Письмо отправлено повторно.</Notice>}
        {error && <Notice tone="error">{error.message}</Notice>}
        <Button type="submit" variant="secondary" busy={busy} disabled={cooldown > 0 || !email}>
          {cooldown > 0 ? `Отправить снова через ${cooldown} с` : 'Отправить письмо ещё раз'}
        </Button>
      </form>
      {auth.dev && email && <Button variant="ghost" onClick={devConfirm}>DEV: подтвердить email без письма</Button>}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { auth } = useServices();
  const [email, setEmail] = useState(rememberedEmail);
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAuthAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (validEmail(email)) return;
    rememberEmail(email);
    if (await run(() => auth.requestPasswordReset(email.trim()))) setSent(true);
  }

  async function devOpenLink() {
    if (await run(() => auth.dev!.openRecoveryLink(email.trim()))) navigate('/auth/recovery', { replace: true });
  }

  return (
    <AuthLayout title="Восстановление пароля" footer={<Link to="/auth/login">Вернуться ко входу</Link>}>
      {sent ? (
        <>
          <Notice tone="success" title="Проверьте почту">Если аккаунт с этим email существует, мы отправили ссылку для смены пароля. Ссылка действует ограниченное время.</Notice>
          <Button variant="secondary" onClick={() => setSent(false)}>Отправить ещё раз</Button>
          {auth.dev && <Button variant="ghost" onClick={devOpenLink}>DEV: открыть ссылку из письма</Button>}
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="muted">Введите email аккаунта — пришлём ссылку для нового пароля.</p>
          <TextField label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={touched ? validEmail(email) : null} required />
          {error && <Notice tone="error">{error.message}</Notice>}
          <Button type="submit" busy={busy}>Отправить ссылку</Button>
        </form>
      )}
    </AuthLayout>
  );
}

function linkError(path: '/auth/callback' | '/auth/recovery'): string | null {
  if (authRedirect.path !== path || (!authRedirect.error && !authRedirect.errorCode)) return null;
  return authRedirect.errorCode === 'otp_expired' || authRedirect.error === 'access_denied' ? authMessages.link_expired : authMessages.unknown;
}

/** Target of the confirmation email (emailRedirectTo). The SDK has already read the link. */
export function AuthCallbackPage() {
  const { user } = useAuth();
  const problem = linkError('/auth/callback');
  useEffect(() => {
    if (!problem && user) { deleteDraft(EMAIL_KEY); navigate('/history', { replace: true }); }
  }, [problem, user]);

  if (problem) {
    return (
      <AuthLayout title="Не удалось подтвердить email" footer={<Link to="/auth/login">Войти</Link>}>
        <Notice tone="error">{problem}</Notice>
        <Button onClick={() => navigate('/auth/check-email')}>Получить новое письмо</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Подтверждение email" footer={<Link to="/auth/login">Войти</Link>}>
      <p>Ссылка не содержит данных входа или уже была использована. Если email подтверждён, просто войдите.</p>
    </AuthLayout>
  );
}

/** Target of the reset email (redirectTo). Must stay reachable while a recovery session is active. */
export function RecoveryPage() {
  const { auth } = useServices();
  const { user, recovery } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAuthAction();
  const problem = linkError('/auth/recovery');
  const errors = {
    password: password.length < MIN_PASSWORD ? `Не меньше ${MIN_PASSWORD} символов.` : null,
    repeat: repeat !== password ? 'Пароли не совпадают.' : null,
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (errors.password || errors.repeat) return;
    const ok = await run(async () => {
      await auth.updatePassword(password);
      // Sign out so the new password is checked by a normal sign-in.
      await auth.signOut();
    });
    if (ok) navigate('/auth/login?reset=done', { replace: true });
  }

  if (problem || !user || !recovery) {
    return (
      <AuthLayout title="Ссылка недействительна" footer={<Link to="/auth/login">Вернуться ко входу</Link>}>
        <Notice tone="error">{problem ?? authMessages.session_missing}</Notice>
        <Button onClick={() => navigate('/auth/forgot')}>Запросить новую ссылку</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Новый пароль">
      <form onSubmit={submit} noValidate>
        <TextField label="Новый пароль" hint={`Минимум ${MIN_PASSWORD} символов.`} type={shown ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={touched ? errors.password : null} required />
        <TextField label="Повторите пароль" type={shown ? 'text' : 'password'} autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} error={touched ? errors.repeat : null} required />
        <PasswordToggle shown={shown} onChange={setShown} />
        {error && <Notice tone="error">{error.message}</Notice>}
        <Button type="submit" busy={busy}>Сохранить пароль</Button>
      </form>
    </AuthLayout>
  );
}
