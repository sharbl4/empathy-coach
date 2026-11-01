import type { ReactNode } from 'react';
import type { OutputFor, SessionDetail } from '@between/contracts';

export function AnalysisView({ analysis, guess }: { analysis: OutputFor<'analysis'>; guess: SessionDetail['guess'] }) {
  return (
    <div className="analysis-body">
      <h3>Что сказано буквально</h3>
      <p>{analysis.literalMeaning}</p>

      <h3>Возможные трактовки</h3>
      <p className="muted">Это гипотезы, а не факты о чувствах собеседника.</p>
      <ol className="interpretations">
        {analysis.interpretations.map((item, index) => (
          <li key={index} className="interpretation">
            <p><strong>{item.emotion}</strong> — возможная потребность: {item.possibleNeed}</p>
            <p>{item.explanation}</p>
            {item.evidenceQuotes.length > 0
              ? <p className="muted">Основания: {item.evidenceQuotes.map((quote, i) => <q key={i}>{quote}</q>).reduce<ReactNode[]>((all, node, i) => i ? [...all, ', ', node] : [node], [])}</p>
              : <p className="muted">Прямых сигналов в тексте нет.</p>}
          </li>
        ))}
      </ol>

      <h3>Чего мы не знаем</h3>
      <p>{analysis.uncertainty}</p>

      <h3>Можно уточнить</h3>
      <p className="question">{analysis.clarifyingQuestion}</p>

      <h3>Сравнение с вашей версией</h3>
      <p className="muted">Ваша версия: {guess.emotions.length ? guess.emotions.join(', ') : 'не понимаю'}.</p>
      <p>{analysis.guessFeedback}</p>

      <h3>Совет</h3>
      <p>{analysis.skillTip}</p>
    </div>
  );
}
