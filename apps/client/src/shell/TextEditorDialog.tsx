import { useEffect, useId, useRef, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { joinSlides, splitSlides } from "../station/show.js";
import { useRun, useStation, type EditorRequest } from "../station/station.js";
import { Button } from "../ui/Button.js";

const textField = (value: string) => ({ kind: "text" as const, value });

/**
 * Editor di un elemento di testo: titolo e testo, una riga vuota separa le
 * slide. Salvando, un elemento nuovo entra in fondo alla scaletta; uno
 * esistente viene aggiornato slide per slide (gli altri campi restano).
 */
export function TextEditorDialog({ request }: { request: EditorRequest }) {
  const t = useT();
  const { state } = useEngine();
  const { closeEditor, select } = useStation();
  const run = useRun();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const existing = request.mode === "edit" ? state?.show.items[request.itemId] : undefined;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [text, setText] = useState(existing === undefined ? "" : joinSlides(existing.slides));
  const [saving, setSaving] = useState(false);
  const slides = splitSlides(text);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  const save = async () => {
    setSaving(true);
    const finalTitle = title.trim();
    if (request.mode === "create") {
      const created = await run("item.create", {
        type: "core.text",
        title: finalTitle,
        slides: slides.map((value) => ({ fields: { text: textField(value) } })),
      });
      const entry = created && (await run("playlist.add", { itemId: created.id }));
      setSaving(false);
      if (entry === undefined) return;
      // La prima slide va in anteprima: Invio la manda in onda.
      select(entry.id);
      if (slides.length > 0) await run("preview.set", { entryId: entry.id, slideIndex: 0 });
      dialog.current?.close();
      return;
    }

    if (existing === undefined) {
      dialog.current?.close();
      return;
    }
    const itemId = existing.id;
    let ok = true;
    if (finalTitle !== existing.title) {
      ok = (await run("item.update", { id: itemId, title: finalTitle })) !== undefined;
    }
    for (let i = 0; ok && i < slides.length; i++) {
      const value = slides[i] ?? "";
      const current = existing.slides[i];
      if (current === undefined) {
        ok =
          (await run("slide.insert", { itemId, slide: { fields: { text: textField(value) } } })) !==
          undefined;
      } else if (current.fields["text"]?.value !== value) {
        const fields = { ...current.fields, text: textField(value) };
        ok = (await run("slide.update", { itemId, slideId: current.id, fields })) !== undefined;
      }
    }
    for (const surplus of existing.slides.slice(slides.length).reverse()) {
      if (!ok) break;
      ok = (await run("slide.delete", { itemId, slideId: surplus.id })) !== undefined;
    }
    setSaving(false);
    if (ok) dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      onClose={() => {
        closeEditor();
        // Il browser rimette il fuoco sul pulsante che ha aperto l'editor: lo si
        // toglie, cosi' Invio e Spazio tornano subito ai comandi della regia.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (slides.length > 0 && !saving) void save();
        }}
      >
        <h2 id={titleId} className="border-b border-line px-5 py-4 text-base font-semibold">
          {t(request.mode === "create" ? "core.editor.newTitle" : "core.editor.editTitle")}
        </h2>
        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {t("core.editor.titleLabel")}
            </span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder={t("core.editor.untitled")}
              className="rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {t("core.editor.textLabel")}
            </span>
            <textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              rows={12}
              className="resize-y rounded-md border border-line-2 bg-bg px-3 py-2 font-display text-base leading-snug"
            />
            <span className="flex justify-between gap-3 text-xs text-faint">
              <span>{t("core.editor.textHint")}</span>
              <span className="shrink-0 font-mono" data-testid="slide-count">
                {t("core.editor.slideCount", { count: slides.length })}
              </span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {t("core.action.cancel")}
          </Button>
          <Button type="submit" tone="primary" disabled={slides.length === 0 || saving}>
            {t("core.action.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
