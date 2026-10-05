import type { LicenseStatus, RegistryPlugin } from "@cuelith/protocol";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useEngine, useT } from "../../engine/react.js";
import { useRun } from "../../station/station.js";
import { Button } from "../../ui/Button.js";
import { INPUT, ModalDialog } from "../../ui/Dialogs.js";

/**
 * Licenze dei plugin a pagamento (decisione 0013), lato postazione. Qui si
 * mostra e si comanda: la chiave di licenza, il permesso e la custodia stanno nel
 * motore, che non rimanda mai la chiave alla postazione.
 */

/** Stato delle licenze di questo computer, riletto quando cambia l'elenco dei plugin. */
export function useLicenses(refreshKey: string) {
  const connection = useConnection();
  const [available, setAvailable] = useState<boolean | undefined>();
  const [licenses, setLicenses] = useState<readonly LicenseStatus[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    connection
      .call("license.list", {})
      .then((result) => {
        if (cancelled) return;
        setAvailable(result.available);
        setLicenses(result.licenses);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, refreshKey, tick]);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  return {
    available,
    byPlugin: new Map(licenses.map((license) => [license.pluginId, license])),
    reload,
  };
}

/** La licenza permette di installare e usare il plugin adesso? */
export const isLicensed = (license: LicenseStatus | undefined): boolean =>
  license?.state === "active" || license?.state === "renew";

/** Una riga che dice in parole semplici come sta la licenza. */
export function LicenseLine({ license }: { license: LicenseStatus | undefined }) {
  const t = useT();
  const { lang } = useEngine();
  const state = license?.state ?? "none";
  const date =
    license?.expires === undefined
      ? ""
      : new Date(license.expires).toLocaleDateString(lang, { dateStyle: "long" });
  const message =
    state === "active"
      ? t("core.modules.licenseActive", { date })
      : state === "renew"
        ? t("core.modules.licenseRenew", { date })
        : state === "expired"
          ? t("core.modules.licenseExpired")
          : state === "revoked"
            ? t("core.modules.licenseRevoked")
            : t("core.modules.licenseNone");
  const bad = state === "expired" || state === "revoked" || state === "none";
  return (
    <p className={`text-xs ${bad ? "text-stage" : "text-cue"}`} role="status">
      {message}
      {license?.test === true && ` (${t("core.modules.licenseTest")})`}
    </p>
  );
}

/** «Verifica ora» e «Disattiva questo computer» per un plugin con licenza. */
export function LicenseActions({
  pluginId,
  license,
  reload,
}: {
  pluginId: string;
  license: LicenseStatus;
  reload: () => void;
}) {
  const t = useT();
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void run("license.refresh", { pluginId }).finally(() => {
            setBusy(false);
            reload();
          });
        }}
      >
        {t("core.modules.verifyNow")}
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setAsking(true);
        }}
      >
        {t("core.modules.deactivateLicense")}
      </Button>
      <span className="sr-only">{license.state}</span>
      {asking && (
        <ModalDialog
          title={t("core.modules.deactivateLicense")}
          onClose={() => {
            setAsking(false);
          }}
        >
          {(close) => (
            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm text-muted">{t("core.modules.deactivateConfirm")}</p>
              <div className="flex justify-end gap-2">
                <Button onClick={close}>{t("core.action.cancel")}</Button>
                <Button
                  tone="live"
                  onClick={() => {
                    close();
                    setBusy(true);
                    void run("license.deactivate", { pluginId }).finally(() => {
                      setBusy(false);
                      reload();
                    });
                  }}
                >
                  {t("core.modules.deactivateLicense")}
                </Button>
              </div>
            </div>
          )}
        </ModalDialog>
      )}
    </div>
  );
}

/**
 * Acquisto e attivazione di un plugin a pagamento non ancora in uso: «Acquista»
 * apre il negozio dell'autore nel browser; la chiave che arriva per email si
 * incolla qui e il motore la fa verificare dal Notaio.
 */
export function PaidBox({
  plugin,
  available,
  openExternal,
  reload,
}: {
  plugin: RegistryPlugin;
  available: boolean | undefined;
  openExternal: (url: string) => void;
  reload: () => void;
}) {
  const t = useT();
  const run = useRun();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  if (available === false) {
    return <p className="text-xs text-stage">{t("core.modules.licenseUnavailable")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {plugin.checkoutUrl !== undefined && (
        <div className="flex flex-col gap-1">
          <div>
            <Button
              tone="cue"
              size="sm"
              onClick={() => {
                if (plugin.checkoutUrl !== undefined) openExternal(plugin.checkoutUrl);
              }}
            >
              {t("core.modules.buy")}
            </Button>
          </div>
          <p className="text-[11px] text-faint">{t("core.modules.buyHint")}</p>
        </div>
      )}
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim().length < 8) return;
          setBusy(true);
          void run("license.activate", { pluginId: plugin.id, licenseKey: key.trim() })
            .then((done) => {
              if (done !== undefined) setKey("");
            })
            .finally(() => {
              setBusy(false);
              reload();
            });
        }}
      >
        <label className="text-xs text-muted" htmlFor={`key-${plugin.id}`}>
          {t("core.modules.licenseKey")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`key-${plugin.id}`}
            type="text"
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("core.modules.licenseKeyExample")}
            onChange={(event) => {
              setKey(event.target.value);
            }}
            className={`${INPUT} min-w-0 flex-1 py-1.5 font-mono text-xs`}
          />
          <Button size="sm" type="submit" disabled={busy || key.trim().length < 8}>
            {busy ? t("core.modules.activating") : t("core.modules.activate")}
          </Button>
        </div>
        <p className="text-[11px] text-faint">{t("core.modules.licenseKeyHint")}</p>
        <p className="text-[11px] text-faint">{t("core.modules.licensePrivacy")}</p>
      </form>
    </div>
  );
}
