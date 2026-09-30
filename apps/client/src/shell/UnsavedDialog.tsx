import { useEffect, useId, useRef } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";

/** "Salvare le modifiche a «nome»?" prima di sostituire lo show aperto. */
export function UnsavedDialog({ question }: { question: number }) {
  const t = useT();
  const { state } = useEngine();
  const { answerUnsaved } = useStation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      // Esc o chiusura = Annulla.
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        answerUnsaved(question, "cancel");
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(460px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-2 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {t("core.file.unsavedQuestion", { name: state?.show.name ?? "" })}
        </h2>
        <p className="text-sm text-muted">{t("core.file.unsavedDetail")}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button
          onClick={() => {
            dialog.current?.close();
          }}
        >
          {t("core.action.cancel")}
        </Button>
        <Button
          tone="live"
          onClick={() => {
            answerUnsaved(question, "discard");
          }}
        >
          {t("core.file.dontSave")}
        </Button>
        <Button
          tone="primary"
          onClick={() => {
            answerUnsaved(question, "save");
          }}
        >
          {t("core.action.save")}
        </Button>
      </div>
    </dialog>
  );
}
