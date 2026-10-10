import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

interface ModalProps {
  title: string;
  children: ComponentChildren;
  actions: ComponentChildren;
  onClose(): void;
}

export function Modal({ title, children, actions, onClose }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div class="overlay" onClick={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <div class="modal-body">{children}</div>
        <div class="modal-actions">{actions}</div>
      </div>
    </div>
  );
}