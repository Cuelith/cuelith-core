import type { InstalledPlugin } from "@cuelith/protocol";
import { useEffect, useRef, useState } from "react";
import { EngineCallError } from "../engine/connection.js";
import { useConnection, useT } from "../engine/react.js";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; plugins: InstalledPlugin[] }
  | { kind: "error"; key: string };

const LOADING: Load = { kind: "loading" };

/** Gestore moduli: elenco dei moduli installati con il loro stato. */
export function ModulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const connection = useConnection();
  const dialog = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>(LOADING);

  // Alla chiusura si torna a "caricamento": alla prossima apertura l'elenco si rilegge.
  const close = () => {
    setLoad(LOADING);
    onClose();
  };

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
      .call("plugin.list", {})
      .then(({ plugins }) => {
        if (!cancelled) setLoad({ kind: "ready", plugins });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            kind: "error",
            key: error instanceof EngineCallError ? error.message : "core.error.internal",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, connection]);

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="modules-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="modules-title" className="text-base font-semibold">
          {t("core.modules.title")}
        </h2>
        <button
          type="button"
          onClick={() => {
            dialog.current?.close();
          }}
          className="rounded-md border border-line-2 px-3 py-1 text-sm text-muted hover:text-fg"
        >
          {t("core.action.close")}
        </button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {t("core.modules.installed")}
        </h3>
        {load.kind === "loading" && (
          <p className="text-sm text-faint">{t("core.modules.loading")}</p>
        )}
        {load.kind === "error" && <p className="text-sm text-live-soft">{t(load.key)}</p>}
        {load.kind === "ready" && (
          <ul className="flex flex-col gap-2">
            {load.plugins.map((plugin) => (
              <li
                key={plugin.manifest.id}
                className="flex items-center gap-3 rounded-lg bg-bg-3 px-3 py-2.5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-mod-chip font-mono text-[11px] font-semibold text-mod">
                  {plugin.manifest.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{plugin.manifest.name}</p>
                  <p className="truncate text-xs text-muted">
                    {t(`core.family.${plugin.manifest.family}`)} · {plugin.manifest.version} ·{" "}
                    {t(`core.pluginState.${plugin.status.state}`)}
                  </p>
                </div>
                {plugin.bundled && (
                  <span className="rounded border border-line-2 px-2 py-0.5 text-[11px] text-muted">
                    {t("core.modules.bundled")}
                  </span>
                )}
                {plugin.required && (
                  <span
                    title={t("core.modules.requiredHint")}
                    className="rounded border border-stage/60 px-2 py-0.5 text-[11px] text-stage"
                  >
                    {t("core.modules.required")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
