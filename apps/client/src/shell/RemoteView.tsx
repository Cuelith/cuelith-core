import { cursorItem, slideSequence, type Slide, type StateDocument } from "@cuelith/protocol";
import { useEffect } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";

const textOf = (slide: Slide | undefined) => slide?.fields["text"]?.value ?? "";

/** La slide in onda e quella che andra' in onda con «Avanti». */
function programAndNext(doc: StateDocument): { title: string; now: string; next: string } {
  const cursor = doc.live.cursor;
  const item = cursorItem(doc, cursor);
  if (item === undefined) return { title: "", now: "", next: "" };
  const slides = slideSequence(item);
  const following = slides[cursor.slideIndex + 1];
  if (following !== undefined || cursor.entryId === undefined) {
    return { title: item.title, now: textOf(slides[cursor.slideIndex]), next: textOf(following) };
  }
  // Ultima slide: la prossima e' la prima della voce seguente in scaletta.
  const index = doc.show.playlist.findIndex((entry) => entry.id === cursor.entryId);
  const entry = doc.show.playlist[index + 1];
  const nextItem = entry === undefined ? undefined : doc.show.items[entry.itemId];
  return {
    title: item.title,
    now: textOf(slides[cursor.slideIndex]),
    next: nextItem === undefined ? "" : textOf(slideSequence(nextItem)[0]),
  };
}

/**
 * Postazione col ruolo Telecomando o Visualizzatore (cap. 9): cio' che e' in
 * onda, la prossima slide e, per il telecomando, due pulsanti grandi. Pensata
 * per il telefono in verticale; frecce e spazio funzionano anche da tastiera.
 */
export function RemoteView({ canControl }: { canControl: boolean }) {
  const t = useT();
  const connection = useConnection();
  const { state, status } = useEngine();

  useEffect(() => {
    if (!canControl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        void connection.call("cue.next", {}).catch(() => undefined);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        void connection.call("cue.prev", {}).catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [canControl, connection]);

  if (state === undefined) return null;
  const { title, now, next } = programAndNext(state);
  const send = (method: "cue.next" | "cue.prev") => {
    void connection.call(method, {}).catch(() => undefined);
  };
  const big =
    "flex-1 rounded-xl border py-6 text-lg font-semibold active:scale-[0.99] disabled:opacity-40";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <img src="/brand/cuelith-logo.png" alt="Cuelith" className="h-7 w-auto" />
        <span className="truncate text-xs text-muted">
          {status.kind === "lost" ? t("core.connection.lost") : state.show.name}
        </span>
      </header>
      <section
        aria-label={t("core.panel.program")}
        className="flex min-h-40 flex-col gap-2 rounded-xl border-2 border-live bg-bg-2 p-4"
      >
        <span className="font-mono text-[11px] font-semibold tracking-widest text-live uppercase">
          {t("core.panel.program")}
        </span>
        {now === "" ? (
          <p className="text-sm text-muted">{t("core.program.empty")}</p>
        ) : (
          <p className="whitespace-pre-line font-display text-xl leading-snug">{now}</p>
        )}
        {title !== "" && <p className="mt-auto truncate text-xs text-muted">{title}</p>}
      </section>
      <section
        aria-label={t("core.remote.next")}
        className="flex min-h-24 flex-col gap-2 rounded-xl border border-cue bg-bg-2 p-4"
      >
        <span className="font-mono text-[11px] font-semibold tracking-widest text-cue uppercase">
          {t("core.remote.next")}
        </span>
        <p className="whitespace-pre-line text-sm text-muted">{next === "" ? "—" : next}</p>
      </section>
      {canControl && (
        <div className="mt-auto flex gap-3">
          <button
            type="button"
            className={`${big} border-line-2 bg-bg-3 text-fg`}
            onClick={() => {
              send("cue.prev");
            }}
          >
            ← {t("core.program.prev")}
          </button>
          <button
            type="button"
            className={`${big} border-cue bg-cue text-cue-ink`}
            onClick={() => {
              send("cue.next");
            }}
          >
            {t("core.program.next")} →
          </button>
        </div>
      )}
    </main>
  );
}
