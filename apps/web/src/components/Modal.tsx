import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native <dialog>: focus trap, Esc to close and a top layer for free. */
export function Modal({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose(): void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id={titleId}>{title}</h2>
      <div className="modal-body">{children}</div>
      <div className="actions">{actions}</div>
    </dialog>
  );
}
