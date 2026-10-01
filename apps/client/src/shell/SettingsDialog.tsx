import { isOnAir, PROTOCOL_VERSION, type Lang } from "@cuelith/protocol";
import { useAppInfo, type AppInfo } from "../station/appInfo.js";
import { useCan } from "../station/roles.js";
import { NetworkSection } from "./NetworkSection.js";
import { ResourcesSection } from "./Resources.js";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import { Button } from "../ui/Button.js";
import { ModalDialog } from "../ui/Dialogs.js";

export type Section =
  "general" | "shortcuts" | "outputs" | "modules" | "network" | "resources" | "about";
const SECTIONS: readonly Section[] = [
  "general",
  "shortcuts",
  "outputs",
  "modules",
  "network",
  "resources",
  "about",
];

/** Nomi fissi delle sezioni dei canti (decisione 0005): non si traducono. */
const SECTION_NAMES: readonly (readonly [string, string])[] = [
  ["V", "Verse"],
  ["C", "Chorus"],
  ["P", "Pre-Chorus"],
  ["B", "Bridge"],
  ["I", "Intro"],
  ["E", "Ending"],
  ["O", "Others"],
];

/** Ctrl su Windows e Linux, ⌘ sul Mac. */
const MOD = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

/**
 * Impostazioni della postazione (ingranaggio in alto, Ctrl+,): generale,
 * scorciatoie (la legenda di tutti i tasti), uscite, moduli, informazioni e
 * licenza. Solo cose che funzionano davvero: niente voci finte.
 */
export function SettingsDialog({
  onClose,
  onManageOutputs,
  onManageModules,
  initialSection = "general",
}: {
  /** Sezione aperta all'inizio (es. Risorse dall'indicatore nella barra in alto). */
  initialSection?: Section;
  onClose: () => void;
  onManageOutputs: () => void;
  onManageModules: () => void;
}) {
  const t = useT();
  const baseId = useId();
  const [section, setSection] = useState<Section>(initialSection);
  // Solo le sezioni che il ruolo di questa postazione puo' usare.
  const can = {
    outputs: useCan("output.config"),
    modules: useCan("plugins"),
    network: useCan("admin"),
  };
  const sections = SECTIONS.filter((id) => !(id in can) || can[id as keyof typeof can]);
  return (
    <ModalDialog title={t("core.settings.title")} onClose={onClose} wide>
      {(close) => (
        <div className="flex min-h-[420px] flex-col sm:flex-row">
          <nav
            aria-label={t("core.settings.sections")}
            className="flex shrink-0 flex-wrap gap-1 border-b border-line p-2 sm:w-48 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0"
          >
            {sections.map((id) => (
              <button
                key={id}
                type="button"
                aria-current={section === id ? "page" : undefined}
                aria-controls={`${baseId}-body`}
                onClick={() => {
                  setSection(id);
                }}
                className={`rounded-md px-3 py-1.5 text-left text-sm ${
                  section === id ? "bg-bg-3 font-semibold text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {t(`core.settings.section.${id}`)}
              </button>
            ))}
          </nav>
          <div
            id={`${baseId}-body`}
            className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-5"
          >
            {section === "general" && <General />}
            {section === "shortcuts" && <Shortcuts />}
            {section === "outputs" && (
              <Row label={t("core.settings.outputs.label")}>
                <Button
                  onClick={() => {
                    close();
                    onManageOutputs();
                  }}
                >
                  {t("core.settings.outputs.open")}
                </Button>
              </Row>
            )}
            {section === "modules" && (
              <Row label={t("core.settings.modules.label")}>
                <Button
                  onClick={() => {
                    close();
                    onManageModules();
                  }}
                >
                  {t("core.settings.modules.open")}
                </Button>
              </Row>
            )}
            {section === "network" && <NetworkSection />}
            {section === "resources" && <ResourcesSection />}
            {section === "about" && <About />}
            <div className="mt-auto flex justify-end">
              <Button onClick={close}>{t("core.action.close")}</Button>
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/** Lingue installate (moduli lingua): quella attiva e le altre. */
function General() {
  const t = useT();
  const connection = useConnection();
  const { lang } = useEngine();
  const [languages, setLanguages] = useState<readonly { lang: Lang; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    connection
      .call("locale.list", {})
      .then((list) => {
        if (!cancelled) setLanguages(list.langs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return (
    <Row label={t("core.settings.general.language")}>
      <span className="text-sm text-muted" data-testid="settings-language">
        {languages.find((l) => l.lang === lang)?.name ?? lang}
      </span>
    </Row>
  );
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-7 rounded-md border border-line-2 bg-bg-3 px-1.5 py-0.5 text-center font-mono text-xs text-fg shadow-[inset_0_-2px_0_var(--color-line)]"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Legenda dei tasti: sostituisce le scritte di spiegazione nell'interfaccia. */
function Shortcuts() {
  const t = useT();
  const groups: readonly {
    title: string;
    rows: readonly (readonly [readonly string[], string])[];
  }[] = [
    {
      title: t("core.shortcuts.group.cue"),
      rows: [
        [["→", t("core.shortcuts.key.space"), "PgDn"], t("core.shortcuts.next")],
        [["←", "PgUp"], t("core.shortcuts.prev")],
        [[t("core.shortcuts.key.enter")], t("core.shortcuts.take")],
        [["Esc"], t("core.shortcuts.clear")],
      ],
    },
    {
      title: t("core.shortcuts.group.sections"),
      rows: [
        ...SECTION_NAMES.map(
          ([key, name]) => [[key], t("core.shortcuts.section", { name })] as const,
        ),
      ],
    },
    {
      title: t("core.shortcuts.group.mouse"),
      rows: [
        [[t("core.shortcuts.key.click")], t("core.shortcuts.select")],
        [[`${MOD}+${t("core.shortcuts.key.click")}`], t("core.shortcuts.selectMore")],
        [
          [`${t("core.shortcuts.key.shift")}+${t("core.shortcuts.key.click")}`],
          t("core.shortcuts.selectRange"),
        ],
        [[t("core.shortcuts.key.doubleClick")], t("core.shortcuts.listPreview")],
        [[t("core.shortcuts.key.click")], t("core.shortcuts.slidePreview")],
        [[t("core.shortcuts.key.doubleClick")], t("core.shortcuts.slideLive")],
      ],
    },
    {
      title: t("core.shortcuts.group.files"),
      rows: [
        [[`${MOD}+N`], t("core.shortcuts.newShow")],
        [[`${MOD}+O`], t("core.shortcuts.open")],
        [[`${MOD}+S`], t("core.shortcuts.save")],
        [[`${MOD}+${t("core.shortcuts.key.shift")}+S`], t("core.shortcuts.saveAs")],
      ],
    },
    {
      title: t("core.shortcuts.group.station"),
      rows: [
        [[`${MOD}+1`], t("core.shortcuts.modePresent")],
        [[`${MOD}+2`], t("core.shortcuts.modeBand")],
        [[`${MOD}+3`], t("core.shortcuts.modeConference")],
        [[`${MOD}+4`], t("core.shortcuts.modeDirector")],
        [[`${MOD}+5`], t("core.shortcuts.modeCompact")],
        [[`${MOD}+,`], t("core.shortcuts.settings")],
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-5" data-testid="shortcuts">
      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            {group.title}
          </h3>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {group.rows.map(([keys, action]) => (
                <tr
                  key={`${keys.join("+")}/${action}`}
                  className="border-b border-line last:border-0"
                >
                  <td className="w-48 py-1.5 pr-3 align-top">
                    <Keys keys={keys} />
                  </td>
                  <td className="py-1.5">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function About() {
  const t = useT();
  const { engineVersion } = useEngine();
  const { info, reload } = useAppInfo();
  return (
    <div className="flex flex-col gap-3">
      <img src="/brand/cuelith-logo.png" alt="Cuelith" className="h-10 w-auto self-start" />
      <Row label={t("core.settings.about.version")}>
        <span className="font-mono text-sm text-muted">{engineVersion ?? "—"}</span>
      </Row>
      <Row label={t("core.settings.about.protocol")}>
        <span className="font-mono text-sm text-muted">{PROTOCOL_VERSION}</span>
      </Row>
      <Row label={t("core.settings.about.edition")}>
        <span className="text-sm text-muted">{t("core.settings.about.community")}</span>
      </Row>
      <Row label={t("core.settings.about.license")}>
        <span className="text-sm text-muted">Apache 2.0</span>
      </Row>
      {info !== undefined && <Updates info={info} reload={reload} />}
      {info?.installationId !== undefined && (
        <Row label={t("core.settings.about.installationId")}>
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted select-all">{info.installationId}</span>
            <Button
              size="sm"
              onClick={() => {
                void window.cuelithDesktop?.resetInstallationId().then(reload);
              }}
            >
              {t("core.settings.about.regenerate")}
            </Button>
          </span>
        </Row>
      )}
      <p className="max-w-prose text-xs leading-relaxed text-muted">
        {t("core.settings.about.privacy")}
      </p>
    </div>
  );
}

/**
 * Aggiornamenti (decisione 0004): si scaricano da soli, si installano solo
 * quando lo decide l'operatore e mai in onda.
 */
function Updates({ info, reload }: { info: AppInfo; reload: () => void }) {
  const t = useT();
  const { state } = useEngine();
  const app = window.cuelithDesktop;
  const [refusal, setRefusal] = useState<string | undefined>();
  const update = info.update;
  const onAir = state !== undefined && isOnAir(state);
  const status = (() => {
    switch (update.status) {
      case "unsupported":
        return t("core.updates.unsupported");
      case "idle":
        return t("core.updates.idle");
      case "checking":
        return t("core.updates.checking");
      case "upToDate":
        return t("core.updates.upToDate");
      case "downloading":
        return t("core.updates.downloading", {
          version: update.version,
          percent: String(update.percent),
        });
      case "ready":
        return t("core.updates.ready", { version: update.version });
      case "error":
        return t("core.updates.error");
    }
  })();
  const install = async () => {
    if (app === undefined) return;
    setRefusal(undefined);
    const result = await app.installUpdate();
    if (result === "onAir") setRefusal(t("core.updates.onAir"));
  };
  return (
    <>
      <Row label={t("core.updates.title")}>
        <span className="text-sm text-muted" role="status">
          {status}
        </span>
      </Row>
      {update.status !== "unsupported" && app !== undefined && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={info.autoCheckUpdates}
              onChange={(event) => {
                void app.setAutoCheckUpdates(event.target.checked).then(reload);
              }}
              className="h-4 w-4 accent-[var(--cl-cue)]"
            />
            {t("core.updates.autoCheck")}
          </label>
          {update.status === "ready" ? (
            <Button
              size="sm"
              tone="primary"
              disabled={onAir}
              title={onAir ? t("core.updates.onAir") : undefined}
              onClick={() => void install()}
            >
              {t("core.updates.install")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={update.status === "checking" || update.status === "downloading"}
              onClick={() => {
                void app.checkUpdates();
              }}
            >
              {t("core.updates.checkNow")}
            </Button>
          )}
        </div>
      )}
      {update.status === "ready" && (onAir || refusal !== undefined) && (
        <p className="text-xs text-stage">{refusal ?? t("core.updates.onAir")}</p>
      )}
    </>
  );
}
