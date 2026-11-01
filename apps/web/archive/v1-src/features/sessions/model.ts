import { SessionInput } from '@between/contracts';
import type { SessionInput as Input } from '../../lib/api/client';

export type Goal = Input['situation']['goal'];

export const goals: { value: Goal; label: string; hint: string }[] = [
  { value: 'support', label: 'Поддержать', hint: 'Показать, что вы рядом и слышите.' },
  { value: 'clarify', label: 'Уточнить', hint: 'Понять, что человек имел в виду.' },
  { value: 'reconcile', label: 'Помириться', hint: 'Снизить напряжение и восстановить контакт.' },
  { value: 'boundary', label: 'Обозначить границу', hint: 'Спокойно сказать, что для вас неприемлемо.' },
];
export const goalLabel = (goal: Goal) => goals.find(item => item.value === goal)?.label ?? goal;

export const emotionSuggestions = ['Нейтральность', 'Усталость', 'Раздражение', 'Обида', 'Тревога', 'Растерянность', 'Грусть', 'Радость'];

export const limits = { title: 200, message: 6000, relationship: 200, context: 4000, emotion: 100, emotions: 3, quotes: 3 };

export interface Draft {
  step: 1 | 2;
  title: string;
  message: string;
  relationship: string;
  context: string;
  goal: Goal | '';
  emotions: string[];
  quotes: string[];
  unsure: boolean;
}

export const emptyDraft = (): Draft => ({ step: 1, title: '', message: '', relationship: '', context: '', goal: '', emotions: [], quotes: [], unsure: false });
export const isDirty = (draft: Draft) => Boolean(draft.message.trim() || draft.relationship.trim() || draft.context.trim() || draft.title.trim());

export function suggestTitle(draft: Draft): string {
  const words = draft.message.trim().replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ');
  const base = draft.relationship.trim() ? `${draft.relationship.trim()}: ${words}` : words;
  return base.length > 80 ? `${base.slice(0, 79)}…` : base;
}

export function toInput(draft: Draft): unknown {
  return {
    title: draft.title.trim(),
    situation: { message: draft.message.trim(), relationship: draft.relationship.trim(), context: draft.context.trim(), goal: draft.goal || undefined },
    guess: { emotions: draft.emotions, evidenceQuotes: draft.quotes, unsure: draft.unsure },
  };
}

export type FieldErrors = Partial<Record<'title' | 'message' | 'relationship' | 'context' | 'goal' | 'emotions' | 'quotes' | 'guess', string>>;

const fieldByPath: Record<string, keyof FieldErrors> = {
  title: 'title', 'situation.message': 'message', 'situation.relationship': 'relationship', 'situation.context': 'context',
  'situation.goal': 'goal', 'guess.emotions': 'emotions', 'guess.evidenceQuotes': 'quotes',
};

const emptyMessages: Partial<Record<keyof FieldErrors, string>> = {
  title: 'Добавьте короткое название — по нему вы найдёте разбор в истории.',
  message: 'Вставьте сообщение, которое хотите понять.',
  relationship: 'Укажите, кто вам написал: коллега, друг, партнёр…',
  goal: 'Выберите цель ответа.',
};

/** Validates with the shared contract schema; messages are UI wording, rules are the contract's. */
export function validate(draft: Draft): { input: Input | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const result = SessionInput.safeParse(toInput(draft));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.slice(0, 2).filter(part => typeof part === 'string').join('.');
      const field = fieldByPath[path] ?? fieldByPath[String(issue.path[0])];
      if (!field || errors[field]) continue;
      const details = issue as { code: string; maximum?: number | bigint; origin?: string };
      if (issue.code === 'custom') errors[field] = 'Цитата должна точно совпадать с фрагментом сообщения.';
      else if (details.code === 'too_big') errors[field] = details.origin === 'array' ? `Не больше ${details.maximum}.` : `Не больше ${details.maximum} символов.`;
      else errors[field] = emptyMessages[field] ?? 'Проверьте поле.';
    }
  }
  if (!draft.unsure && draft.emotions.length === 0) errors.guess = 'Выберите хотя бы одну эмоцию или отметьте «Не понимаю».';
  return { input: result.success && !errors.guess ? result.data : null, errors };
}

export const stepOneFields: (keyof FieldErrors)[] = ['message', 'relationship', 'context', 'goal', 'title'];
