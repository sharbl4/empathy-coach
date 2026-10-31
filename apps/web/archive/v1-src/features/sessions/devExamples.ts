// DEV ONLY: fictional situations from the shared contract fixtures, offered in fixture mode.
// Loaded through a dynamic import guarded by import.meta.env.DEV.
import { situations } from '@between/contracts/fixtures';
import type { Draft } from './model';

export const DEV_FAIL_HINT = 'Добавьте в сообщение [dev:fail], чтобы проверить неудачный разбор.';

export function devExamples(): (Partial<Draft> & { title: string })[] {
  return situations.map(item => ({
    step: 1 as const,
    title: item.title,
    message: item.situation.message,
    relationship: item.situation.relationship,
    context: item.situation.context,
    goal: item.situation.goal,
    emotions: item.guess.emotions,
    quotes: item.guess.evidenceQuotes,
    unsure: item.guess.unsure,
  }));
}
