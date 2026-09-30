import { useEngine, useT } from "../engine/react.js";
import type { ShowFiles } from "../station/files.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";

/** Dopo una chiusura non corretta: riaprire la copia automatica o lasciarla. */
export function RecoveryBanner({ files }: { files: ShowFiles }) {
  const t = useT();
  const { state, lang } = useEngine();
  const run = useRun();
  const recovery = state?.live.recovery;
  if (recovery === undefined) return null;
  const time = new Date(recovery.savedAt).toLocaleString(lang, {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <div
      role="status"
      className="col-span-2 flex flex-wrap items-center gap-3 border-b border-stage/40 bg-stage-bg px-4 py-2 text-sm"
    >
      <span className="flex-1 text-stage">
        {t("core.file.recovery", { name: recovery.showName, time })}
      </span>
      <Button tone="primary" size="sm" onClick={() => void files.reopenRecovery()}>
        {t("core.file.recoveryOpen")}
      </Button>
      <Button size="sm" onClick={() => void run("show.discardRecovery", {})}>
        {t("core.file.recoveryDiscard")}
      </Button>
    </div>
  );
}
