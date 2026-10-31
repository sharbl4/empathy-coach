import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useServices } from '../../app/context';
import { navigate, setNavigationBlocker } from '../../app/router';
import { Modal } from '../../components/Modal';
import { Button, DevBadge, Notice, TextArea, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/api/errors';
import { deleteDraft, readDraft, writeDraft } from '../../lib/drafts';
import { emotionSuggestions, emptyDraft, goals, isDirty, limits, stepOneFields, suggestTitle, validate, type Draft, type FieldErrors } from './model';

const DRAFT_KEY = 'new-session';

export function NewSessionPage() {
  const { api, mode } = useServices();
  const [draft, setDraftState] = useState<Draft>(() => readDraft<Draft>(DRAFT_KEY) ?? emptyDraft());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leave, setLeave] = useState<null | (() => void)>(null);
  const [customEmotion, setCustomEmotion] = useState('');
  const [manualQuote, setManualQuote] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const messageView = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const savingRef = useRef(false);
  const [dev, setDev] = useState<null | { hint: string; examples: (Partial<Draft> & { title: string })[] }>(null);

  useEffect(() => {
    if (import.meta.env.DEV && mode === 'fixtures') {
      void import('./devExamples').then(module => setDev({ hint: module.DEV_FAIL_HINT, examples: module.devExamples() }));
    }
  }, [mode]);

  const setDraft = (patch: Partial<Draft>) => setDraftState(previous => {
    const next = { ...previous, ...patch };
    writeDraft(DRAFT_KEY, next);
    return next;
  });
  const { input, errors } = validate(draft);
  const visible: FieldErrors = showErrors ? errors : {};
  const stepOneValid = stepOneFields.every(field => !errors[field]);

  // Leaving the page keeps the draft in memory; offer to save it to history via the API.
  useEffect(() => {
    if (!isDirty(draft) || saving) { setNavigationBlocker(null); return; }
    setNavigationBlocker(retry => { setLeave(() => retry); return false; });
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => { setNavigationBlocker(null); window.removeEventListener('beforeunload', onUnload); };
  }, [draft, saving]);

  useEffect(() => { heading.current?.focus(); }, [draft.step]);

  function next(event: FormEvent) {
    event.preventDefault();
    const withTitle = draft.title.trim() ? draft : { ...draft, title: suggestTitle(draft) };
    if (withTitle !== draft) setDraft({ title: withTitle.title });
    const check = validate(withTitle).errors;
    if (stepOneFields.some(field => check[field])) { setShowErrors(true); return; }
    setShowErrors(false);
    setDraft({ step: 2 });
  }

  async function save(target: Draft = draft) {
    const parsed = validate(target).input;
    if (!parsed || savingRef.current) { setShowErrors(true); return null; }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const session = await api.createSession(parsed);
      deleteDraft(DRAFT_KEY);
      setNavigationBlocker(null);
      return session;
    } catch (error) {
      // The typed text stays: nothing is cleared on failure.
      setSaveError(errorMessage(error));
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input) { setShowErrors(true); return; }
    const session = await save();
    if (session) navigate(`/sessions/${session.id}?start=1`, { force: true });
  }

  async function saveAndLeave() {
    const retry = leave;
    // Saving without a guess records an honest "не понимаю" rather than inventing one.
    const force = draft.unsure || draft.emotions.length ? draft : { ...draft, unsure: true };
    const session = await save(force.title.trim() ? force : { ...force, title: suggestTitle(force) });
    if (session) { setLeave(null); retry?.(); }
  }

  function toggleEmotion(emotion: string) {
    if (draft.emotions.includes(emotion)) setDraft({ emotions: draft.emotions.filter(item => item !== emotion) });
    else if (draft.emotions.length < limits.emotions) setDraft({ emotions: [...draft.emotions, emotion], unsure: false });
  }

  function addCustomEmotion() {
    const value = customEmotion.trim();
    if (!value || draft.emotions.includes(value) || draft.emotions.length >= limits.emotions || value.length > limits.emotion) return;
    setDraft({ emotions: [...draft.emotions, value], unsure: false });
    setCustomEmotion('');
  }

  function addQuote(raw: string) {
    const quote = raw.trim();
    setQuoteError(null);
    if (!quote) { setQuoteError('Выделите фрагмент в сообщении или впишите фразу.'); return false; }
    if (!draft.message.trim().includes(quote)) { setQuoteError('Такой фразы нет в сообщении. Цитата должна совпадать дословно.'); return false; }
    if (draft.quotes.includes(quote)) return true;
    if (draft.quotes.length >= limits.quotes) { setQuoteError(`Можно выбрать до ${limits.quotes} цитат.`); return false; }
    setDraft({ quotes: [...draft.quotes, quote] });
    return true;
  }

  function addSelection() {
    const view = messageView.current;
    if (!view) return;
    addQuote(view.value.slice(view.selectionStart, view.selectionEnd));
  }

  const message = draft.message.trim();

  return (
    <section className="page">
      <p className="eyebrow">Шаг {draft.step} из 2</p>
      <h1 ref={heading} tabIndex={-1}>{draft.step === 1 ? 'Новый разбор' : 'Сначала твоя версия'}</h1>

      {draft.step === 1 ? (
        <form onSubmit={next} noValidate className="card">
          <Notice title="Перед отправкой уберите личные данные">Замените имена, телефоны, адреса и другие детали, по которым можно узнать людей. Текст отправляется на сервер и в модель для разбора.</Notice>
          {dev && (
            <DevBadge>
              Подставить вымышленный пример:{' '}
              {dev.examples.map(example => <button key={example.title} type="button" className="link-button" onClick={() => setDraft(example)}>{example.title}</button>)}
              {' '}{dev.hint}
            </DevBadge>
          )}
          <TextArea label="Сообщение собеседника" hint="Вставьте одно сообщение или короткий фрагмент переписки." rows={6} value={draft.message} onChange={e => setDraft({ message: e.target.value })} error={visible.message} counter={{ value: draft.message.length, max: limits.message }} required />
          <TextField label="Кто вам написал" hint="Например: коллега, друг, партнёр, мама." value={draft.relationship} onChange={e => setDraft({ relationship: e.target.value })} error={visible.relationship} counter={{ value: draft.relationship.length, max: limits.relationship }} required />
          <TextArea label="Контекст (необязательно)" hint="Что происходило до этого сообщения?" rows={3} value={draft.context} onChange={e => setDraft({ context: e.target.value })} error={visible.context} counter={{ value: draft.context.length, max: limits.context }} />
          <fieldset aria-describedby={visible.goal ? 'goal-error' : undefined}>
            <legend>Чего вы хотите от ответа?</legend>
            <div className="choice-grid">
              {goals.map(goal => (
                <label key={goal.value} className={`choice${draft.goal === goal.value ? ' choice-on' : ''}`}>
                  <input type="radio" name="goal" value={goal.value} checked={draft.goal === goal.value} onChange={() => setDraft({ goal: goal.value })} />
                  <span><strong>{goal.label}</strong><span className="muted">{goal.hint}</span></span>
                </label>
              ))}
            </div>
            {visible.goal && <p className="field-error" id="goal-error">{visible.goal}</p>}
          </fieldset>
          <TextField label="Название разбора" hint="Видно только вам, нужно для поиска в истории. Пустое заполним из сообщения." value={draft.title} onChange={e => setDraft({ title: e.target.value })} error={visible.title} counter={{ value: draft.title.length, max: limits.title }} />
          <div className="actions"><Button type="submit">Дальше: моя версия</Button></div>
        </form>
      ) : (
        <form onSubmit={submit} noValidate className="card">
          <p className="muted">Попробуйте сначала сами предположить, что чувствует собеседник. Это гипотеза, а не экзамен: «не понимаю» — тоже честный ответ.</p>

          <fieldset>
            <legend>Что, по-вашему, чувствует собеседник? До {limits.emotions}.</legend>
            <div className="chips">
              {emotionSuggestions.map(emotion => (
                <button key={emotion} type="button" className="chip" aria-pressed={draft.emotions.includes(emotion)} disabled={draft.unsure || (!draft.emotions.includes(emotion) && draft.emotions.length >= limits.emotions)} onClick={() => toggleEmotion(emotion)}>{emotion}</button>
              ))}
              {draft.emotions.filter(emotion => !emotionSuggestions.includes(emotion)).map(emotion => (
                <button key={emotion} type="button" className="chip" aria-pressed="true" onClick={() => toggleEmotion(emotion)}>{emotion} ✕</button>
              ))}
            </div>
            <div className="inline-add">
              <TextField label="Своя эмоция" value={customEmotion} maxLength={limits.emotion} disabled={draft.unsure || draft.emotions.length >= limits.emotions} onChange={e => setCustomEmotion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomEmotion(); } }} />
              <Button variant="secondary" onClick={addCustomEmotion} disabled={!customEmotion.trim() || draft.unsure || draft.emotions.length >= limits.emotions}>Добавить</Button>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={draft.unsure} onChange={e => setDraft({ unsure: e.target.checked, emotions: e.target.checked ? [] : draft.emotions })} /> Не понимаю, что чувствует собеседник
            </label>
            {visible.guess && <p className="field-error">{visible.guess}</p>}
            {visible.emotions && <p className="field-error">{visible.emotions}</p>}
          </fieldset>

          <fieldset>
            <legend>Какие слова на это указывают? Необязательно, до {limits.quotes}.</legend>
            <TextArea label="Сообщение" hint="Выделите фрагмент (мышью или Shift + стрелки) и нажмите «Добавить выделенное»." readOnly rows={Math.min(8, Math.max(3, Math.ceil(message.length / 60)))} value={message} ref={messageView} />
            <div className="actions"><Button variant="secondary" onClick={addSelection} disabled={draft.quotes.length >= limits.quotes}>Добавить выделенное</Button></div>
            <div className="inline-add">
              <TextField label="Или впишите фразу дословно" value={manualQuote} onChange={e => setManualQuote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (addQuote(manualQuote)) setManualQuote(''); } }} />
              <Button variant="secondary" onClick={() => { if (addQuote(manualQuote)) setManualQuote(''); }} disabled={draft.quotes.length >= limits.quotes}>Добавить</Button>
            </div>
            {(quoteError || visible.quotes) && <p className="field-error" role="alert">{quoteError ?? visible.quotes}</p>}
            {draft.quotes.length > 0 && (
              <ul className="quote-list">
                {draft.quotes.map(quote => (
                  <li key={quote}><q>{quote}</q> <Button variant="ghost" aria-label={`Убрать цитату «${quote}»`} onClick={() => setDraft({ quotes: draft.quotes.filter(item => item !== quote) })}>Убрать</Button></li>
                ))}
              </ul>
            )}
          </fieldset>

          {saveError && <Notice tone="error" title="Не удалось сохранить">{saveError} Введённый текст сохранён — можно повторить.</Notice>}
          <div className="actions">
            <Button variant="secondary" onClick={() => setDraft({ step: 1 })} disabled={saving}>Назад к ситуации</Button>
            <Button type="submit" busy={saving}>{saving ? 'Сохраняем…' : 'Сохранить и разобрать'}</Button>
          </div>
        </form>
      )}

      <Modal open={leave !== null} title="Уйти со страницы?" onClose={() => setLeave(null)} actions={<>
        <Button onClick={saveAndLeave} busy={saving} disabled={!stepOneValid}>Сохранить в историю</Button>
        <Button variant="secondary" onClick={() => { const retry = leave; setLeave(null); setNavigationBlocker(null); retry?.(); }} disabled={saving}>Уйти, черновик в памяти</Button>
        <Button variant="ghost" onClick={() => setLeave(null)} disabled={saving}>Остаться</Button>
      </>}>
        <p>Черновик останется в этой вкладке до перезагрузки страницы или выхода из аккаунта.</p>
        {stepOneValid
          ? <p className="muted">Можно сохранить ситуацию в историю без разбора{draft.emotions.length || draft.unsure ? '' : ' — гипотеза будет отмечена как «не понимаю»'}.</p>
          : <p className="muted">Чтобы сохранить в историю, заполните сообщение, отношения и цель.</p>}
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </Modal>
    </section>
  );
}
