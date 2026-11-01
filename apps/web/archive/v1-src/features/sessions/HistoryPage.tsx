import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/context';
import { Link, navigate } from '../../app/router';
import { Modal } from '../../components/Modal';
import { Button, Loading, Notice } from '../../components/ui';
import type { Session } from '../../lib/api/client';
import { errorMessage, isAbort } from '../../lib/api/errors';
import { useProfile } from '../account/profile';
import { goalLabel } from './model';

const PAGE_SIZE = 20;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

function Onboarding() {
  const { api } = useServices();
  const { me, setMe } = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || me.onboardingCompletedAt) return null;
  async function done() {
    setBusy(true);
    setError(null);
    try { setMe(await api.updateMe({ onboardingCompleted: true })); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  return (
    <section className="card onboarding" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">Как это работает</h2>
      <ol>
        <li>Вставьте сообщение, которое трудно понять, и выберите цель ответа.</li>
        <li>Сначала предположите сами, что чувствует собеседник. «Не понимаю» — тоже ответ.</li>
        <li>Получите разбор: буквальный смысл, несколько трактовок и вопрос для уточнения.</li>
      </ol>
      <p className="muted">Чужие чувства нельзя знать наверняка: разбор предлагает гипотезы, а не диагнозы и не оценку вас.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions"><Button onClick={done} busy={busy}>Понятно</Button><Button variant="secondary" onClick={() => navigate('/new')}>Начать разбор</Button></div>
    </section>
  );
}

export function HistoryPage() {
  const { api } = useServices();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<Session[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [toDelete, setToDelete] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(timer); }, [query]);

  // A new search aborts the previous one, so a slow stale response never replaces fresh results.
  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setLoading(true);
    setError(null);
    api.sessions({ q: debounced || undefined, limit: PAGE_SIZE }, controller.signal)
      .then(page => { setItems(page.items); setCursor(page.nextCursor); })
      .catch(caught => { if (!isAbort(caught)) setError(errorMessage(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, debounced, attempt]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.sessions({ q: debounced || undefined, limit: PAGE_SIZE, cursor }, controller.signal);
      setItems(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (caught) {
      if (!isAbort(caught)) setError(errorMessage(caught));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSession(toDelete.id);
      setItems(previous => previous.filter(item => item.id !== toDelete.id));
      setToDelete(null);
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>История</h1>
        <Button onClick={() => navigate('/new')}>Новый разбор</Button>
      </div>
      <Onboarding />

      <div className="field search">
        <label htmlFor="history-search">Поиск по названию</label>
        <input id="history-search" type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} autoComplete="off" />
      </div>

      {error && <Notice tone="error" action={<Button variant="secondary" onClick={() => (items.length && cursor ? loadMore() : setAttempt(value => value + 1))}>Повторить</Button>}>{error}</Notice>}

      {loading ? <Loading label="Загружаем историю…" /> : !error && items.length === 0 ? (
        debounced
          ? <p className="muted">Ничего не нашлось по запросу «{debounced}».</p>
          : <div className="card empty"><p>Здесь появятся ваши разборы. Начните с сообщения, которое хочется понять.</p><Button onClick={() => navigate('/new')}>Первый разбор</Button></div>
      ) : (
        <ul className="history-list" aria-label="Разборы">
          {items.map(item => (
            <li key={item.id} className="history-item">
              <div>
                <Link to={`/sessions/${item.id}`} className="history-title">{item.title}</Link>
                <p className="muted small">{item.situation.relationship} · {goalLabel(item.situation.goal)} · {formatDate(item.updatedAt)}</p>
              </div>
              <Button variant="ghost" aria-label={`Удалить «${item.title}»`} onClick={() => { setDeleteError(null); setToDelete(item); }}>Удалить</Button>
            </li>
          ))}
        </ul>
      )}
      {!loading && cursor && <div className="actions"><Button variant="secondary" onClick={loadMore} busy={loadingMore}>Показать ещё</Button></div>}

      <Modal open={toDelete !== null} title="Удалить разбор?" onClose={() => setToDelete(null)} actions={<>
        <Button variant="danger" onClick={remove} busy={deleting}>Удалить</Button>
        <Button variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>Отмена</Button>
      </>}>
        <p>«{toDelete?.title}» и все его результаты будут удалены. Отменить нельзя.</p>
        {deleteError && <Notice tone="error">{deleteError}</Notice>}
      </Modal>
    </section>
  );
}
