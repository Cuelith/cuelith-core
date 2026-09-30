import {
  DisplayTargetSchema,
  type DisplayInfo,
  type OutputConfig,
  type StateDocument,
} from "@cuelith/protocol";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useConnection, useEngine, useT, type Translate } from "../engine/react.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";

const PRESENTATION = "core.presentation";

interface Draft {
  readonly id: string | undefined;
  readonly name: string;
  readonly displayId: string;
  readonly mode: "fullscreen" | "window";
  readonly lookId: string;
}

function displayLabel(t: Translate, displays: readonly DisplayInfo[], id: string): string {
  const index = displays.findIndex((d) => d.id === id);
  const display = displays[index];
  if (display === undefined) return t("core.output.displayMissing");
  const label = t("core.outputs.displayOption", { n: index + 1, label: display.label });
  return display.primary ? `${label} · ${t("core.outputs.primary")}` : label;
}

function presentationLooks(doc: StateDocument) {
  return Object.values(doc.show.looks).filter((l) => l.sourceType === PRESENTATION);
}

function draftOf(output: OutputConfig): Draft | undefined {
  const target = DisplayTargetSchema.safeParse(output.target);
  if (!target.success || output.feed.type !== "source") return undefined;
  return {
    id: output.id,
    name: output.name,
    displayId: target.data.displayId,
    mode: target.data.mode,
    lookId: output.feed.lookId ?? "",
  };
}

/** Uscite su monitor: elenco, aggiunta, modifica, eliminazione. */
export function OutputsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { state } = useEngine();
  const connection = useConnection();
  const run = useRun();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [displays, setDisplays] = useState<readonly DisplayInfo[]>([]);
  const [draft, setDraft] = useState<Draft | undefined>();
  const [deleting, setDeleting] = useState<string | undefined>();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    connection
      .call("display.list", {})
      .then(({ displays: list }) => {
        if (!cancelled) setDisplays(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, connection]);

  if (state === undefined) return null;
  const outputs = Object.values(state.show.outputs);
  const looks = presentationLooks(state);
  const source = Object.values(state.show.sources).find((s) => s.type === PRESENTATION);

  const startNew = () => {
    const used = new Set(
      outputs.flatMap((o) => {
        const target = DisplayTargetSchema.safeParse(o.target);
        return target.success && target.data.mode === "fullscreen" ? [target.data.displayId] : [];
      }),
    );
    // Proposta: il primo monitor libero che non e' quello della postazione.
    const display =
      displays.find((d) => !d.primary && !used.has(d.id)) ?? displays.find((d) => !used.has(d.id));
    setDraft({
      id: undefined,
      name: t("core.outputs.newName", { n: outputs.length + 1 }),
      displayId: display?.id ?? displays[0]?.id ?? "",
      mode: display === undefined || display.primary ? "window" : "fullscreen",
      lookId: looks.find((l) => l.template === "core.fullscreen")?.id ?? looks[0]?.id ?? "",
    });
  };

  const save = async () => {
    if (draft === undefined || source === undefined) return;
    const display = displays.find((d) => d.id === draft.displayId);
    const target = { displayId: draft.displayId, mode: draft.mode };
    const feed = { type: "source" as const, sourceId: source.id, lookId: draft.lookId };
    const format = {
      width: Math.round((display?.bounds.width ?? 1920) * (display?.scaleFactor ?? 1)),
      height: Math.round((display?.bounds.height ?? 1080) * (display?.scaleFactor ?? 1)),
      fps: 60,
    };
    const result =
      draft.id === undefined
        ? await run("output.create", {
            name: draft.name.trim() || t("core.outputs.newName", { n: outputs.length + 1 }),
            kind: "display",
            provider: "core",
            target,
            format,
            feed,
          })
        : await run("output.update", {
            id: draft.id,
            name: draft.name.trim(),
            target,
            format,
            feed,
          });
    if (result !== undefined) setDraft(undefined);
  };

  const selected = displays.find((d) => d.id === draft?.displayId);
  const coversStation = draft?.mode === "fullscreen" && selected?.primary === true;

  return (
    <dialog
      ref={dialog}
      onClose={() => {
        setDraft(undefined);
        setDeleting(undefined);
        onClose();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t("core.outputs.title")}
        </h2>
        <Button
          onClick={() => {
            dialog.current?.close();
          }}
        >
          {t("core.action.close")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4">
        {outputs.length === 0 && draft === undefined && (
          <p className="text-sm text-muted">{t("core.outputs.empty")}</p>
        )}
        <ul className="flex flex-col gap-2" aria-label={t("core.outputs.title")}>
          {outputs.map((output) => {
            const current = draftOf(output);
            const live = state.live.outputs[output.id];
            const look = current === undefined ? undefined : state.show.looks[current.lookId];
            return (
              <li
                key={output.id}
                className="flex items-center gap-3 rounded-lg bg-bg-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{output.name}</p>
                  <p className="truncate text-xs text-muted">
                    {current === undefined
                      ? output.kind
                      : t("core.outputs.summary", {
                          display: displayLabel(t, displays, current.displayId),
                          mode: t(`core.outputs.mode.${current.mode}`),
                          look: look?.name ?? "—",
                        })}
                  </p>
                  {live?.status === "error" && live.error !== undefined && (
                    <p className="text-xs text-stage">{t(live.error)}</p>
                  )}
                </div>
                {deleting === output.id ? (
                  <>
                    <Button
                      tone="live"
                      size="sm"
                      onClick={() => {
                        setDeleting(undefined);
                        void run("output.delete", { id: output.id });
                      }}
                    >
                      {t("core.outputs.confirmDelete")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setDeleting(undefined);
                      }}
                    >
                      {t("core.action.cancel")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      disabled={current === undefined}
                      onClick={() => {
                        setDraft(current);
                      }}
                    >
                      {t("core.action.edit")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setDeleting(output.id);
                      }}
                    >
                      {t("core.action.remove")}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        {draft === undefined ? (
          <div>
            <Button tone="cue" onClick={startNew} disabled={displays.length === 0}>
              + {t("core.outputs.add")}
            </Button>
            {displays.length === 0 && (
              <p className="mt-2 text-xs text-faint">{t("core.outputs.noDisplays")}</p>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 rounded-lg border border-line-2 p-4"
            aria-label={t(draft.id === undefined ? "core.outputs.add" : "core.outputs.edit")}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label={t("core.outputs.name")}>
              <input
                value={draft.name}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                }}
                className="rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
              />
            </Field>
            <Field label={t("core.outputs.display")}>
              <select
                value={draft.displayId}
                onChange={(event) => {
                  setDraft({ ...draft, displayId: event.target.value });
                }}
                className="rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
              >
                {displays.map((display) => (
                  <option key={display.id} value={display.id}>
                    {displayLabel(t, displays, display.id)}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {t("core.outputs.modeLabel")}
              </legend>
              <div className="flex gap-4 text-sm">
                {(["fullscreen", "window"] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={draft.mode === mode}
                      onChange={() => {
                        setDraft({ ...draft, mode });
                      }}
                    />
                    {t(`core.outputs.mode.${mode}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={t("core.outputs.look")}>
              <select
                value={draft.lookId}
                onChange={(event) => {
                  setDraft({ ...draft, lookId: event.target.value });
                }}
                className="rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
              >
                {looks.map((look) => (
                  <option key={look.id} value={look.id}>
                    {look.name}
                  </option>
                ))}
              </select>
            </Field>
            {coversStation && (
              <p className="text-xs text-stage">{t("core.outputs.coversStation")}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setDraft(undefined);
                }}
              >
                {t("core.action.cancel")}
              </Button>
              <Button
                type="submit"
                tone="primary"
                disabled={draft.displayId === "" || draft.lookId === ""}
              >
                {t("core.action.save")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
