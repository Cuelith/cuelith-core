import { useEffect, useId, useState, type ReactNode } from "react";
import { useT } from "../engine/react.js";
import { Button } from "./Button.js";

const DIALOG =
  "m-auto w-[min(460px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60";

/** Finestra modale che si apre al montaggio; Esc o chiusura chiamano onClose. */
export function ModalDialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}) {
  // L'elemento sta nello stato (non in un ref): "close" si puo' passare ai figli.
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    if (element !== null && !element.open) element.showModal();
  }, [element]);
  const close = () => {
    element?.close();
  };
  return (
    <dialog
      ref={setElement}
      onClose={onClose}
      aria-labelledby={titleId}
      className={wide ? DIALOG.replace("460px", "720px") : DIALOG}
    >
      <h2 id={titleId} className="border-b border-line px-5 py-4 text-base font-semibold">
        {title}
      </h2>
      {children(close)}
    </dialog>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
      {children}
    </span>
  );
}

export const INPUT = "rounded-md border border-line-2 bg-bg px-3 py-2 text-sm";

/** Chiede un testo (es. il nome di una libreria). onSubmit restituisce true se e' andato a buon fine. */
export function PromptDialog({
  title,
  label,
  initial = "",
  confirm,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  onSubmit: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  return (
    <ModalDialog title={title} onClose={onClose}>
      {(close) => (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = value.trim();
            if (trimmed === "") return;
            void onSubmit(trimmed).then((ok) => {
              if (ok) close();
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{label}</FieldLabel>
            <input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              className={INPUT}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("core.action.cancel")}</Button>
            <Button type="submit" tone="primary" disabled={value.trim() === ""}>
              {confirm}
            </Button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}

/** Conferma di un'azione che non si puo' annullare. */
export function ConfirmDialog({
  title,
  message,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <ModalDialog title={title} onClose={onClose}>
      {(close) => (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-sm text-muted">{message}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("core.action.cancel")}</Button>
            <Button
              tone="live"
              onClick={() => {
                onConfirm();
                close();
              }}
            >
              {confirm}
            </Button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
