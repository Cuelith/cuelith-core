import type { PairedStation } from "@cuelith/protocol";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { INPUT } from "../ui/Dialogs.js";

/** Ruoli che si possono dare a una postazione in rete (cap. 9). */
const ROLES = ["operator", "remote", "viewer", "director"] as const;

/** Codice QR dell'indirizzo (immagine incorporata: nessuna richiesta esterna). */
function QrCode({ text, label }: { text: string; label: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createDataURL(4, 8);
  }, [text]);
  return <img src={src} alt={label} className="h-32 w-32 rounded-md bg-white" />;
}

/** Secondi che mancano alla scadenza del codice. */
function useCountdown(expiresAt: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [expiresAt]);
  return expiresAt === undefined ? 0 : Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

/**
 * Impostazioni → Rete e postazioni (passo 8): aprire il motore alla rete
 * locale, abbinare una postazione con un codice, vedere chi e' abbinato e
 * revocare. Si fa solo dal computer del motore.
 */
export function NetworkSection() {
  const t = useT();
  const run = useRun();
  const { state } = useEngine();
  const network = state?.live.network;
  const clients = state?.live.clients;
  const [interfaces, setInterfaces] = useState<readonly { name: string; address: string }[]>([]);
  const [stations, setStations] = useState<readonly PairedStation[]>([]);
  const [role, setRole] = useState<(typeof ROLES)[number]>("operator");
  /** Codice in corso, con le postazioni che c'erano quando e' stato chiesto. */
  const [started, setStarted] = useState<
    { code: string; expiresAt: string; known: readonly string[] } | undefined
  >();
  const [revoking, setRevoking] = useState<string | undefined>();
  const seconds = useCountdown(started?.expiresAt);

  const reload = useCallback(
    () =>
      run("pairing.list", {}).then((list) => {
        if (list === undefined) return;
        setStations(list.stations);
        // Una postazione nuova in elenco: il codice e' stato usato, non serve piu'.
        setStarted((current) =>
          current !== undefined && list.stations.some((s) => !current.known.includes(s.id))
            ? undefined
            : current,
        );
      }),
    [run],
  );

  useEffect(() => {
    void run("network.interfaces", {}).then((result) => {
      if (result !== undefined) setInterfaces(result.interfaces);
    });
  }, [run]);
  // Una postazione si collega o si scollega: l'elenco si aggiorna da solo.
  const online = new Set((clients ?? []).flatMap((c) => (c.pairedId ? [c.pairedId] : [])));
  const onlineKey = [...online].sort().join(" ");
  useEffect(() => {
    void reload();
  }, [reload, onlineKey]);
  // Il codice sparisce anche quando scade.
  const pairing = started !== undefined && seconds > 0 ? started : undefined;

  if (window.cuelithDesktop === undefined) {
    return <p className="text-sm text-muted">{t("core.network.localOnly")}</p>;
  }
  const enabled = network?.enabled === true;
  const url = network?.urls[0];
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => {
            void run("network.set", { enabled: event.target.checked });
          }}
          className="h-4 w-4 accent-[var(--cl-cue)]"
        />
        {t("core.network.enable")}
      </label>
      <p className="max-w-prose text-xs text-muted">{t("core.network.intro")}</p>

      {enabled && interfaces.length > 1 && (
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {t("core.network.address")}
          <select
            className={INPUT}
            value={network.address ?? ""}
            onChange={(event) => {
              void run("network.set", { enabled: true, address: event.target.value });
            }}
          >
            {interfaces.map((i) => (
              <option key={i.address} value={i.address}>
                {i.address} · {i.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {enabled && network.error !== undefined && (
        <p role="alert" className="text-sm text-stage">
          {t(network.error)}
        </p>
      )}

      {enabled && url !== undefined && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <QrCode text={url} label={t("core.network.qr")} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted">{t("core.network.open")}</span>
              <span data-testid="network-url" className="font-mono text-sm break-all select-all">
                {url}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-sm font-semibold">{t("core.network.pair")}</span>
            {pairing === undefined ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t("core.network.role")}
                  className={INPUT}
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as (typeof ROLES)[number]);
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`core.role.${r}`)}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    void run("pairing.start", { role }).then((result) => {
                      setStarted(
                        result === undefined
                          ? undefined
                          : { ...result, known: stations.map((s) => s.id) },
                      );
                    });
                  }}
                >
                  {t("core.network.showCode")}
                </Button>
                <span className="basis-full text-xs text-muted">
                  {t(`core.network.roleHint.${role}`)}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="pairing-code"
                  className="rounded-md bg-bg-3 px-3 py-1.5 font-mono text-2xl tracking-[0.3em]"
                >
                  {pairing.code}
                </span>
                <span className="text-xs text-muted">
                  {t("core.network.codeHint", {
                    role: t(`core.role.${role}`),
                    seconds: String(seconds),
                  })}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    void run("pairing.cancel", {});
                    setStarted(undefined);
                  }}
                >
                  {t("core.action.cancel")}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {stations.length > 0 && (
        <ul
          aria-label={t("core.network.stations")}
          className="flex flex-col gap-1.5 border-t border-line pt-3"
        >
          {stations.map((station) => (
            <li key={station.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${online.has(station.id) ? "bg-cue" : "bg-line-2"}`}
              />
              <span className="min-w-0 flex-1 truncate">{station.name}</span>
              <span className="text-xs text-muted">
                {t(`core.role.${station.role}`)} ·{" "}
                {t(online.has(station.id) ? "core.network.online" : "core.network.offline")}
              </span>
              {revoking === station.id ? (
                <Button
                  size="sm"
                  tone="live"
                  onClick={() => {
                    setRevoking(undefined);
                    void run("session.revoke", { clientId: station.id }).then(reload);
                  }}
                >
                  {t("core.network.revokeConfirm")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  aria-label={t("core.network.revokeNamed", { name: station.name })}
                  onClick={() => {
                    setRevoking(station.id);
                  }}
                >
                  {t("core.network.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
