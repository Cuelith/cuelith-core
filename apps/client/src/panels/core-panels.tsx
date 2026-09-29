import type { ComponentType } from "react";
import { useEngine, useT } from "../engine/react.js";
import { EmptyState, Panel } from "../ui/Panel.js";
import { Screen } from "../ui/Screen.js";

function PlaylistPanel() {
  const t = useT();
  const { state } = useEngine();
  const entries = state?.show.playlist ?? [];
  return (
    <Panel label={t("core.panel.playlist")}>
      {entries.length === 0 ? (
        <EmptyState title={t("core.playlist.empty")} hint={t("core.playlist.emptyHint")} />
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md bg-bg-3 px-3 py-2 text-sm">
              {state?.show.items[entry.itemId]?.title}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function SlidesPanel() {
  const t = useT();
  return (
    <Panel label={t("core.panel.slides")}>
      <EmptyState title={t("core.slides.empty")} />
    </Panel>
  );
}

function ProgramPanel() {
  const t = useT();
  return (
    <Panel label={t("core.panel.program")} labelHidden>
      <Screen tone="live" label={t("core.panel.program")}>
        <span className="font-body text-sm text-faint">{t("core.program.empty")}</span>
      </Screen>
    </Panel>
  );
}

function PreviewPanel() {
  const t = useT();
  return (
    <Panel label={t("core.panel.preview")} labelHidden>
      <div className="w-[55%] min-w-40">
        <Screen tone="cue" label={t("core.panel.preview")}>
          <span className="font-body text-xs text-faint">{t("core.preview.empty")}</span>
        </Screen>
      </div>
    </Panel>
  );
}

/** Pannelli del nucleo, per id qualificato. */
export const CORE_PANEL_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  "core.playlist": PlaylistPanel,
  "core.slides": SlidesPanel,
  "core.program": ProgramPanel,
  "core.preview": PreviewPanel,
};
