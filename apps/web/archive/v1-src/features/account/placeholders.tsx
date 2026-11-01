// Interim screens for the shell PR. History, new situation and the session view
// land in the next PR; Practice and Settings are day-2 work.
export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </section>
  );
}
