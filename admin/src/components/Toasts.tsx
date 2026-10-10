import { dismissToast, toasts, type ToastKind } from '../store';

const ICON_PATHS: Record<ToastKind, string> = {
  success: 'M20 6 9 17l-5-5',
  error: 'M18 6 6 18M6 6l12 12',
  warn: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
};

export function Toasts() {
  return (
    <div class="toasts" role="region" aria-live="polite" aria-label="通知">
      {toasts.value.map((item) => (
        <div class={`toast ${item.kind}`} key={item.id} onClick={() => dismissToast(item.id)}>
          <span class="toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d={ICON_PATHS[item.kind]} />
            </svg>
          </span>
          <div class="toast-body">
            <div>{item.message}</div>
            {item.detail ? <div class="detail">{item.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}