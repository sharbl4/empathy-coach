import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/context';
import { navigate, useLocation } from '../../app/router';
import { Modal } from '../../components/Modal';
import { Button, Loading, Notice } from '../../components/ui';
import type { Run, SessionDetail } from '../../lib/api/client';
import { ApiFailure, errorMessage, isAbort, runErrorMessages } from '../../lib/api/errors';
import { finishIntent, intentKey } from '../../lib/intents';
import { useRunPolling } from '../../lib/useRunPolling';
import { AnalysisView } from './AnalysisView';
import { goalLabel } from './model';

type AnalysisRun = Extract<Run, { kind: 'analysis' }>;

/** Latest analysis run of the current revision. Older revisions are never shown as current. */
function currentAnalysis(detail: SessionDetail): AnalysisRun | null {
  const runs = detail.runs.filter((run): run is AnalysisRun => run.kind === 'analysis' && run.revision === detail.revision);
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return runs[0] ?? null;
}

const formatDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function SessionPage({ id }: { id: string }) {
  const { api } = useServices();
  const { search } = useLocation();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const autoStarted = useRef(false);
  const { state: poll, resume } = useRunPolling(pendingRunId);

  // Load (and reload) the saved session; a refresh restores everything from the server.
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    api.session(id, controller.signal)
      .then(next => {
        setDetail(next);
        const run = currentAnalysis(next);
        setPendingRunId(run?.status === 'pending' ? run.id : null);
      })
      .catch(error => { if (!isAbort(error)) setLoadError(error instanceof ApiFailure ? error : new ApiFailure('network')); });
    return () => controller.abort();
  }, [api, id, attempt]);

  // A finished poll is merged into the detail, but only if it belongs to the revision on screen.
  useEffect(() => {
    if (poll.phase !== 'done') return;
    setDetail(previous => previous && poll.run.sessionId === previous.id
      ? { ...previous, runs: [...previous.runs.filter(run => run.id !== poll.run.id), poll.run] }
      : previous);
    setPendingRunId(null);
  }, [poll]);

  const startAnalysis = useCallback(async (target: SessionDetail) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    const scope = `analyze:${target.id}:${target.revision}`;
    const key = intentKey(scope, { expectedRevision: target.revision });
    try {
      const accepted = await api.analyze(target.id, target.revision, key);
      finishIntent(scope);
      setPendingRunId(accepted.runId);
    } catch (error) {
      if (!(error instanceof ApiFailure && error.retryable)) finishIntent(scope);
      if (error instanceof ApiFailure && (error.code === 'REVISION_CONFLICT' || error.code === 'OPERATION_IN_PROGRESS')) setAttempt(value => value + 1);
      setStartError(errorMessage(error));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [api]);

  // Right after creation (?start=1) the analysis starts once; the flag is then removed from the URL.
  useEffect(() => {
    if (!detail || autoStarted.current || !new URLSearchParams(search).has('start')) return;
    autoStarted.current = true;
    navigate(`/sessions/${id}`, { replace: true, force: true });
    if (!currentAnalysis(detail)) void startAnalysis(detail);
  }, [detail, id, search, startAnalysis]);

  async function remove() {
    if (!detail) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSession(detail.id);
      navigate('/history', { replace: true, force: true });
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <section className="page">
        <h1>Разбор</h1>
        <Notice tone="error" action={loadError.code === 'NOT_FOUND'
          ? <Button variant="secondary" onClick={() => navigate('/history')}>К истории</Button>
          : <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Повторить</Button>}>
          {loadError.message}
        </Notice>
      </section>
    );
  }
  if (!detail) return <section className="page"><Loading label="Загружаем разбор…" /></section>;

  const analysis = currentAnalysis(detail);
  const hasOlder = detail.runs.some(run => run.kind === 'analysis' && run.revision !== detail.revision);
  const waiting = pendingRunId !== null || analysis?.status === 'pending';
  const { situation, guess } = detail;

  return (
    <section className="page">
      <p className="eyebrow">{goalLabel(situation.goal)} · {formatDate(detail.updatedAt)}{detail.revision > 1 ? ` · версия ${detail.revision}` : ''}</p>
      <h1>{detail.title}</h1>

      <div className="two-col">
        <article className="card">
          <h2>Сообщение</h2>
          <blockquote className="message">{situation.message}</blockquote>
          <dl className="meta">
            <dt>Кто написал</dt><dd>{situation.relationship}</dd>
            {situation.context && <><dt>Контекст</dt><dd>{situation.context}</dd></>}
            <dt>Цель ответа</dt><dd>{goalLabel(situation.goal)}</dd>
          </dl>
        </article>
        <article className="card">
          <h2>Ваша версия</h2>
          {guess.unsure && guess.emotions.length === 0
            ? <p>Не понимаю, что чувствует собеседник.</p>
            : <p>{guess.emotions.join(', ')}{guess.unsure ? ' (не уверены)' : ''}</p>}
          {guess.evidenceQuotes.length > 0 && <ul className="quote-list">{guess.evidenceQuotes.map(quote => <li key={quote}><q>{quote}</q></li>)}</ul>}
        </article>
      </div>

      <section className="card analysis" aria-labelledby="analysis-title" aria-busy={waiting || undefined}>
        <h2 id="analysis-title">Разбор</h2>
        {hasOlder && <p className="muted">Результаты прежней версии ситуации здесь не показаны.</p>}

        {waiting && poll.phase !== 'lost' && (
          <>
            <Loading label="Разбираем сообщение… обычно это занимает до минуты." />
            <p className="muted">Можно уйти со страницы: результат сохранится и будет ждать в истории.</p>
          </>
        )}
        {waiting && poll.phase === 'lost' && (
          <Notice tone="error" action={<Button variant="secondary" onClick={resume}>Проверить снова</Button>}>{poll.message}</Notice>
        )}

        {!waiting && analysis?.status === 'succeeded' && <AnalysisView analysis={analysis.output} guess={guess} />}

        {!waiting && analysis?.status === 'failed' && (
          <Notice tone="error" title="Разбор не получился" action={<Button onClick={() => startAnalysis(detail)} busy={starting}>Повторить разбор</Button>}>
            {runErrorMessages[analysis.errorCode]} Ваши данные сохранены.
          </Notice>
        )}

        {!waiting && !analysis && (
          <>
            <p className="muted">Разбор ещё не запускался.</p>
            <Button onClick={() => startAnalysis(detail)} busy={starting}>Запустить разбор</Button>
          </>
        )}
        {startError && <Notice tone="error" title="Не удалось запустить разбор">{startError}</Notice>}
      </section>

      <div className="actions">
        <Button variant="secondary" onClick={() => navigate('/history')}>К истории</Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={waiting}>Удалить разбор</Button>
      </div>
      {waiting && <p className="muted small">Удалить можно после завершения разбора.</p>}

      <Modal open={confirmDelete} title="Удалить разбор?" onClose={() => setConfirmDelete(false)} actions={<>
        <Button variant="danger" onClick={remove} busy={deleting}>Удалить</Button>
        <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Отмена</Button>
      </>}>
        <p>Будут удалены сообщение, ваша версия и все результаты этого разбора. Отменить нельзя.</p>
        {deleteError && <Notice tone="error">{deleteError}</Notice>}
      </Modal>
    </section>
  );
}
