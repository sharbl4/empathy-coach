import {Link} from '../../app/router';
import {Loading,Notice} from '../../components/ui';
import {api,errorText} from '../../lib/api';
import {formatDate,skillLabels} from '../../lib/labels';
import {useAsync} from '../../lib/useAsync';

export function ProgressPage() {
  const data=useAsync(signal=>Promise.all([api('progress',{},{signal}),api('skillAttempts',{limit:20},{signal})]),[]);
  if(!data.data)return data.loading?<Loading label="Загружаем прогресс"/>:<Notice tone="error">{errorText(data.error)}</Notice>;
  const [p,attempts]=data.data;
  return (
    <>
      <h1>Прогресс</h1>
      <p className="small muted">Счётчики ваших учебных действий. Процента эмпатии нет, и это не оценка личности.</p>
      <dl className="meta card"><dt>Разобрано ситуаций</dt><dd>{p.analyzedSessions}</dd><dt>Упражнений</dt><dd>{p.completedExercises}</dd><dt>Диалогов</dt><dd>{p.completedRoleplays}</dd><dt>Практик дня</dt><dd>{p.completedDailyPractices}</dd><dt>Карточек</dt><dd>{p.completedCards}</dd>
        <dt>Серия практики дня</dt><dd>{p.streak.current} (лучшая {p.streak.best}) — пропуски не штрафуются</dd></dl>
      <section className="card"><h2>Навыки</h2><p className="small muted">Отдельно: сколько было практик и оценка последней конкретной попытки по рубрике 0–2.</p>
        <ul>{p.skills.map(s=><li key={s.skill}><strong>{skillLabels[s.skill]}</strong>: практик {s.completedAttempts}{s.latestScore!==null&&`, последняя попытка ${s.latestScore}/2`}</li>)}</ul>
        <h3>Оценённые попытки</h3>{attempts.items.length?<ul>{attempts.items.map(a=><li key={a.id}>{skillLabels[a.skill]} — {a.score}/2: {a.rationale} <span className="small muted">({formatDate(a.createdAt)})</span></li>)}</ul>:<p className="muted">Пока нет.</p>}
      </section>
      {p.latestTip&&<Notice title="Последний совет">{p.latestTip}</Notice>}
      {p.followupEligibleAt&&<p>Повторный тест доступен с {new Date(p.followupEligibleAt).toLocaleDateString('ru-RU')}. <Link to="/practice">К тесту</Link></p>}
      <p><Link to="/history">К истории →</Link></p>
    </>
  );
}
