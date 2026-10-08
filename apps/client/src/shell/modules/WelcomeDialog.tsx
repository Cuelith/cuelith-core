import type { PluginManifest, RegistryPlugin } from "@cuelith/protocol";
import { useEffect, useState } from "react";
import { useConnection, useEngine, useT } from "../../engine/react.js";
import { useRun } from "../../station/station.js";
import { showTab } from "../../station/tabs.js";
import { Button } from "../../ui/Button.js";
import { ModalDialog } from "../../ui/Dialogs.js";
import { Cover, HowToUse, ModuleIcon, permissionLabel } from "./ModulesWindow.js";
import { OnboardingDialog } from "./OnboardingDialog.js";

/** Quanti plugin proporre al primo avvio: pochi, i piu' utili. */
const FEATURED = 4;
/** Il primo che serve a chi arriva da un'altra parte: i brani. */
const FIRST = "cuelith.songs";

/** I plugin da proporre: gratuiti, non lingue, quelli verificati per primi (Brani prima di tutti). */
export function featuredPlugins(plugins: readonly RegistryPlugin[]): RegistryPlugin[] {
  return plugins
    .filter((p) => p.family !== "locale" && p.access === "free")
    .sort(
      (a, b) =>
        Number(b.id === FIRST) - Number(a.id === FIRST) ||
        Number(b.verified) - Number(a.verified) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, FEATURED);
}

/**
 * Avvio guidato (decisione 0018): Cuelith parte leggero e i plugin li sceglie chi lo usa.
 * Compare la prima volta, quando non c'e' ancora nessuno strumento; propone i plugin piu' utili
 * con cosa fanno e che permessi chiedono, li installa con un clic e apre lo strumento.
 */
export function WelcomeDialog({
  onClose,
  onOpenPlugins,
}: {
  onClose: () => void;
  onOpenPlugins: () => void;
}) {
  const t = useT();
  const connection = useConnection();
  const { lang } = useEngine();
  const run = useRun();
  const [plugins, setPlugins] = useState<readonly RegistryPlugin[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  /** Plugin installati qui, con lo strumento da aprire (se ne ha uno). */
  const [done, setDone] = useState<ReadonlyMap<string, string | undefined>>(new Map());
  const [guide, setGuide] = useState<PluginManifest | undefined>();
  const [attempt, setAttempt] = useState(0);
  /** Qualcosa e' stato installato da questa finestra: il pulsante di chiusura dice «Fatto». */
  const [installedNow, setInstalledNow] = useState(false);

  // Quello che c'è già: riaprendo la guida più tardi non si propone di nuovo ciò che è installato.
  useEffect(() => {
    let alive = true;
    connection.call("plugin.list", {}).then(
      ({ plugins: list }) => {
        if (!alive) return;
        setDone(
          new Map(
            list.map(({ manifest }) => {
              const side = manifest.contributes.panels?.find(
                (panel) => (panel.placement ?? "side") === "side",
              );
              return [manifest.id, side === undefined ? undefined : `${manifest.id}.${side.id}`];
            }),
          ),
        );
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [connection]);

  useEffect(() => {
    let alive = true;
    connection.call("registry.list", attempt === 0 ? {} : { refresh: true }).then(
      (result) => {
        if (!alive) return;
        setPlugins(featuredPlugins(result.plugins));
        setFailed(result.source === "none");
      },
      () => {
        if (!alive) return;
        setPlugins([]);
        setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [connection, attempt]);

  const install = async (plugin: RegistryPlugin) => {
    setBusy(plugin.id);
    const installed = await run("plugin.installFromRegistry", { id: plugin.id });
    setBusy(undefined);
    if (installed === undefined) return;
    setInstalledNow(true);
    const list = await connection.call("plugin.list", {});
    const manifest = list.plugins.find((p) => p.manifest.id === plugin.id)?.manifest;
    const side = manifest?.contributes.panels?.find(
      (panel) => (panel.placement ?? "side") === "side",
    );
    setDone((current) =>
      new Map(current).set(plugin.id, side === undefined ? undefined : `${plugin.id}.${side.id}`),
    );
    if (manifest?.onboarding !== undefined) setGuide(manifest);
  };

  return (
    <ModalDialog title={t("core.welcome.title")} onClose={onClose} wide>
      {(close) => (
        <div className="flex max-h-[80vh] flex-col gap-4 px-5 py-4">
          <p className="text-sm text-muted">{t("core.welcome.lead")}</p>
          {plugins === undefined && (
            <p role="status" className="py-6 text-center text-sm text-muted">
              {t("core.library.searching")}
            </p>
          )}
          {plugins !== undefined && plugins.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p role="status" className="text-sm text-muted">
                {t(failed ? "core.welcome.offline" : "core.welcome.nothing")}
              </p>
              <Button
                onClick={() => {
                  setPlugins(undefined);
                  setAttempt((n) => n + 1);
                }}
              >
                {t("core.welcome.retry")}
              </Button>
            </div>
          )}
          <ul
            aria-label={t("core.welcome.list")}
            className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 overflow-y-auto"
          >
            {(plugins ?? []).map((plugin) => {
              const version = plugin.versions[0];
              const installedHere = done.has(plugin.id);
              const tool = done.get(plugin.id);
              return (
                <li
                  key={plugin.id}
                  className="flex flex-col gap-2 rounded-lg border border-line bg-bg-3 p-3"
                >
                  <div className="flex items-start gap-2">
                    <ModuleIcon src={plugin.icon} name={plugin.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{plugin.name}</p>
                      <p className="truncate text-xs text-muted">{plugin.publisher}</p>
                    </div>
                  </div>
                  <Cover src={plugin.image} />
                  <p className="text-sm text-muted">{plugin.description}</p>
                  <HowToUse guide={plugin.guide} lang={lang} />
                  {version !== undefined && version.permissions.length > 0 && (
                    <p className="text-xs text-faint">
                      {t("core.welcome.permissions", {
                        list: version.permissions.map((p) => permissionLabel(t, p)).join(", "),
                      })}
                    </p>
                  )}
                  <div className="mt-auto pt-1">
                    {installedHere ? (
                      tool === undefined ? (
                        <span className="text-xs text-cue">{t("core.welcome.installed")}</span>
                      ) : (
                        <Button
                          tone="cue"
                          size="sm"
                          onClick={() => {
                            showTab(tool);
                            close();
                          }}
                        >
                          {t("core.welcome.open")}
                        </Button>
                      )
                    ) : (
                      <Button
                        tone="cue"
                        size="sm"
                        disabled={busy !== undefined}
                        onClick={() => void install(plugin)}
                      >
                        {busy === plugin.id
                          ? t("core.modules.installing")
                          : t("core.modules.install")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-faint">{t("core.welcome.again")}</p>
          <div className="flex justify-between gap-2">
            <Button
              onClick={() => {
                close();
                onOpenPlugins();
              }}
            >
              {t("core.welcome.all")}
            </Button>
            <Button tone="primary" onClick={close}>
              {installedNow ? t("core.welcome.done") : t("core.welcome.later")}
            </Button>
          </div>
          {guide !== undefined && (
            <OnboardingDialog
              manifest={guide}
              onClose={() => {
                setGuide(undefined);
              }}
            />
          )}
        </div>
      )}
    </ModalDialog>
  );
}
