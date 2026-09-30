import {
  isActivePlugin,
  type InstalledPlugin,
  type PluginManifest,
  type RegistryPlugin,
} from "@cuelith/protocol";
import { pluginIconUrl } from "../../station/modulePanels.js";
import { useEffect, useId, useState } from "react";
import { useConnection, useEngine, useT, type Translate } from "../../engine/react.js";
import { useRun, useStation } from "../../station/station.js";
import { Button } from "../../ui/Button.js";
import { INPUT, ModalDialog } from "../../ui/Dialogs.js";
import { OnboardingDialog } from "./OnboardingDialog.js";

type Tab = "market" | "installed";

interface Market {
  readonly plugins: readonly RegistryPlugin[];
  readonly source: "network" | "cache" | "none";
  readonly fetchedAt?: string | undefined;
}

/** Confronto di versioni semplice "1.2.10" > "1.2.9" (le versioni vengono gia' validate). */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

function permissionLabel(t: Translate, permission: string): string {
  if (permission.startsWith("network:")) {
    return t("core.permission.networkHost", { host: permission.slice("network:".length) });
  }
  return t(`core.permission.${permission.replace(":", ".")}`);
}

/** Apre la documentazione nel browser del sistema (solo indirizzi https). */
function openDocs(url: string): void {
  const desktop = window.cuelithDesktop;
  if (desktop !== undefined) void desktop.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Finestra Moduli (decisione 0004): Marketplace per scoprire e installare,
 * Installati per attivare, disattivare, aggiornare, disinstalla e rivedere
 * la guida al primo uso.
 */
export function ModulesWindow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("market");
  const [guide, setGuide] = useState<PluginManifest | undefined>();
  const installed = useEngine().state?.live.plugins;
  const tabsId = useId();

  return (
    <ModalDialog title={t("core.modules.title")} onClose={onClose} wide>
      {(close) => (
        <div className="flex max-h-[80vh] flex-col">
          <div
            role="tablist"
            aria-label={t("core.modules.title")}
            className="flex gap-4 border-b border-line px-5"
          >
            {(["market", "installed"] as const).map((id) => (
              <button
                key={id}
                id={`${tabsId}-${id}`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                }}
                className={`-mb-px border-b-2 py-2.5 text-[13px] ${
                  tab === id
                    ? "border-fg font-semibold text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t(`core.modules.tab.${id}`)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            aria-labelledby={`${tabsId}-${tab}`}
            className="min-h-80 overflow-auto px-5 py-4"
          >
            {tab === "market" ? (
              <Marketplace installedKey={JSON.stringify(installed)} onInstalled={setGuide} />
            ) : (
              <Installed onGuide={setGuide} />
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button onClick={close}>{t("core.action.close")}</Button>
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

function useInstalledList(installedKey: string): readonly InstalledPlugin[] {
  const connection = useConnection();
  const [list, setList] = useState<readonly InstalledPlugin[]>([]);
  useEffect(() => {
    let cancelled = false;
    connection
      .call("plugin.list", {})
      .then(({ plugins }) => {
        if (!cancelled) setList(plugins);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, installedKey]);
  return list;
}

function Marketplace({
  installedKey,
  onInstalled,
}: {
  installedKey: string;
  onInstalled: (manifest: PluginManifest) => void;
}) {
  const t = useT();
  const { lang } = useEngine();
  const connection = useConnection();
  const run = useRun();
  const [market, setMarket] = useState<Market | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<{ plugin: RegistryPlugin; update: boolean } | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const installed = useInstalledList(installedKey);

  const load = (refresh: boolean) => {
    setRefreshing(true);
    connection
      .call("registry.list", { refresh })
      .then((result) => {
        setMarket(result);
      })
      .catch(() => {
        setMarket({ plugins: [], source: "none" });
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    connection
      .call("registry.list", {})
      .then((result) => {
        if (!cancelled) setMarket(result);
      })
      .catch(() => {
        if (!cancelled) setMarket({ plugins: [], source: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const install = async (plugin: RegistryPlugin) => {
    setConfirm(undefined);
    setBusy(plugin.id);
    const done = await run("plugin.installFromRegistry", { id: plugin.id });
    setBusy(undefined);
    if (done === undefined) return;
    const { plugins } = await connection.call("plugin.list", {});
    const manifest = plugins.find((p) => p.manifest.id === plugin.id)?.manifest;
    if (manifest?.onboarding !== undefined) onInstalled(manifest);
  };

  const status =
    market === undefined
      ? t("core.library.searching")
      : market.source === "network"
        ? t("core.modules.fromNetwork")
        : market.source === "cache"
          ? market.fetchedAt === undefined
            ? t("core.modules.fromCacheUndated")
            : t("core.modules.fromCache", {
                date: new Date(market.fetchedAt).toLocaleString(lang, {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              })
          : t("core.modules.unreachable");

  const q = query.trim().toLocaleLowerCase();
  const plugins = (market?.plugins ?? []).filter(
    (p) => q === "" || `${p.name} ${p.description} ${p.publisher}`.toLocaleLowerCase().includes(q),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label={t("core.modules.search")}
          placeholder={t("core.modules.searchHint")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className={`${INPUT} min-w-0 flex-1 py-1.5`}
        />
        <Button
          onClick={() => {
            load(true);
          }}
          disabled={refreshing}
        >
          {t("core.modules.refresh")}
        </Button>
      </div>
      <p
        className={`text-xs ${market?.source === "none" ? "text-stage" : "text-faint"}`}
        aria-live="polite"
      >
        {status}
      </p>
      {market !== undefined && plugins.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {t(
            market.source === "none"
              ? "core.modules.marketEmptyOffline"
              : "core.modules.marketEmpty",
          )}
        </p>
      )}
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
        aria-label={t("core.modules.tab.market")}
      >
        {plugins.map((plugin) => {
          const latest = plugin.versions[0];
          const mine = installed.find((p) => p.manifest.id === plugin.id);
          const canUpdate =
            mine !== undefined &&
            latest !== undefined &&
            newer(latest.version, mine.manifest.version);
          return (
            <li
              key={plugin.id}
              className="flex flex-col gap-2 rounded-lg border border-line bg-bg-3 p-3"
            >
              <div className="flex items-start gap-2">
                <ModuleIcon src={plugin.icon} name={plugin.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{plugin.name}</p>
                  <p className="truncate text-xs text-muted">
                    {plugin.publisher} · {t(`core.family.${plugin.family}`)} · {latest?.version}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                    plugin.verified ? "border-cue/60 text-cue" : "border-stage/60 text-stage"
                  }`}
                  title={t(
                    plugin.verified ? "core.modules.verifiedHint" : "core.modules.unverifiedHint",
                  )}
                >
                  {t(plugin.verified ? "core.modules.verified" : "core.modules.unverified")}
                </span>
              </div>
              <p className="text-sm text-muted">{plugin.description}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                {mine === undefined ? (
                  <Button
                    tone="cue"
                    size="sm"
                    disabled={busy !== undefined}
                    onClick={() => {
                      setConfirm({ plugin, update: false });
                    }}
                  >
                    {busy === plugin.id ? t("core.modules.installing") : t("core.modules.install")}
                  </Button>
                ) : canUpdate ? (
                  <Button
                    tone="cue"
                    size="sm"
                    disabled={busy !== undefined}
                    onClick={() => {
                      setConfirm({ plugin, update: true });
                    }}
                  >
                    {busy === plugin.id
                      ? t("core.modules.installing")
                      : t("core.modules.updateTo", { version: latest.version })}
                  </Button>
                ) : (
                  <span className="text-xs text-faint">{t("core.modules.installedLabel")}</span>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    openDocs(plugin.repository);
                  }}
                >
                  {t("core.modules.docs")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm !== undefined && (
        <ModalDialog
          title={t(confirm.update ? "core.modules.confirmUpdate" : "core.modules.confirmInstall", {
            name: confirm.plugin.name,
          })}
          onClose={() => {
            setConfirm(undefined);
          }}
        >
          {(close) => {
            const permissions = confirm.plugin.versions[0]?.permissions ?? [];
            return (
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted">
                  {permissions.length === 0
                    ? t("core.modules.noPermissions")
                    : t("core.modules.permissionsIntro")}
                </p>
                {permissions.length > 0 && (
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                    {permissions.map((p) => (
                      <li key={p}>{permissionLabel(t, p)}</li>
                    ))}
                  </ul>
                )}
                {!confirm.plugin.verified && (
                  <p className="text-sm text-stage">{t("core.modules.unverifiedHint")}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button onClick={close}>{t("core.action.cancel")}</Button>
                  <Button tone="primary" onClick={() => void install(confirm.plugin)}>
                    {t(confirm.update ? "core.modules.update" : "core.modules.install")}
                  </Button>
                </div>
              </div>
            );
          }}
        </ModalDialog>
      )}
    </div>
  );
}

function Installed({ onGuide }: { onGuide: (manifest: PluginManifest) => void }) {
  const t = useT();
  const run = useRun();
  const { notify } = useStation();
  const installedKey = JSON.stringify(useEngine().state?.live.plugins);
  const plugins = useInstalledList(installedKey);
  const [removing, setRemoving] = useState<InstalledPlugin | undefined>();
  const desktop = window.cuelithDesktop;

  const installFromFile = async () => {
    if (desktop === undefined) return;
    const path = await desktop.chooseModuleFile();
    if (path === undefined) return;
    const done = await run("plugin.install", { path });
    if (done === undefined) return;
    notify("core.modules.installedNotice", { id: done.id, version: done.version }, "info");
    // Come dal marketplace: subito la guida al primo uso, se il modulo ne ha una.
    const list = await run("plugin.list", {});
    const manifest = list?.plugins.find((p) => p.manifest.id === done.id)?.manifest;
    if (manifest?.onboarding !== undefined) onGuide(manifest);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label={t("core.modules.tab.installed")}>
        {plugins.map((plugin) => {
          const { manifest, status } = plugin;
          const problem = status.error;
          return (
            <li
              key={manifest.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-3 px-3 py-2.5"
            >
              <ModuleIcon src={pluginIconUrl(manifest)} name={manifest.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{manifest.name}</p>
                <p className="truncate text-xs text-muted">
                  {t(`core.family.${manifest.family}`)} ·{" "}
                  {t(
                    isActivePlugin(manifest)
                      ? "core.modules.kind.active"
                      : "core.modules.kind.passive",
                  )}{" "}
                  · {manifest.version} · {t(`core.modules.source.${plugin.source}`)} ·{" "}
                  {t(`core.pluginState.${status.state}`)}
                </p>
                {problem !== undefined && <p className="text-xs text-stage">{t(problem)}</p>}
              </div>
              <label
                className="flex items-center gap-2 text-xs text-muted"
                title={plugin.required ? t("core.modules.requiredHint") : undefined}
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={plugin.enabled}
                  disabled={plugin.required && plugin.enabled}
                  aria-label={t("core.modules.toggle", { name: manifest.name })}
                  onChange={(event) => {
                    void run(event.target.checked ? "plugin.enable" : "plugin.disable", {
                      pluginId: manifest.id,
                    });
                  }}
                  className="h-4 w-4 accent-[var(--cl-cue)]"
                />
                {t(plugin.enabled ? "core.modules.on" : "core.modules.off")}
              </label>
              {manifest.onboarding !== undefined && (
                <Button
                  size="sm"
                  onClick={() => {
                    onGuide(manifest);
                  }}
                >
                  {t("core.modules.guide")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  openDocs(manifest.docs?.url ?? manifest.repository);
                }}
              >
                {t("core.modules.docs")}
              </Button>
              {plugin.source !== "bundled" && (
                <Button
                  size="sm"
                  onClick={() => {
                    setRemoving(plugin);
                  }}
                >
                  {t("core.modules.uninstall")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-line pt-3">
        <Button size="sm" disabled={desktop === undefined} onClick={() => void installFromFile()}>
          {t("core.modules.installFromFile")}
        </Button>
        <span className="text-xs text-faint">{t("core.modules.installFromFileHint")}</span>
      </div>
      {removing !== undefined && (
        <ModalDialog
          title={t("core.modules.confirmUninstall", { name: removing.manifest.name })}
          onClose={() => {
            setRemoving(undefined);
          }}
        >
          {(close) => (
            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm text-muted">
                {t(
                  removing.bundled
                    ? "core.modules.uninstallBackToBundled"
                    : "core.modules.uninstallMessage",
                )}
              </p>
              <div className="flex justify-end gap-2">
                <Button onClick={close}>{t("core.action.cancel")}</Button>
                <Button
                  tone="live"
                  onClick={() => {
                    void run("plugin.uninstall", { pluginId: removing.manifest.id });
                    close();
                  }}
                >
                  {t("core.modules.uninstall")}
                </Button>
              </div>
            </div>
          )}
        </ModalDialog>
      )}
    </div>
  );
}

/** Icona del modulo (SVG del pacchetto o del registry); sigla solo se manca. */
function ModuleIcon({ src, name }: { src: string | undefined; name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-mod-chip font-mono text-[11px] font-semibold text-mod">
      {src === undefined ? (
        name.slice(0, 2).toUpperCase()
      ) : (
        <img src={src} alt="" className="h-6 w-6" draggable={false} />
      )}
    </span>
  );
}
