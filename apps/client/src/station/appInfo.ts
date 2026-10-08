import { useCallback, useEffect, useRef, useState } from "react";

// Informazioni dell'app desktop (decisione 0004): versione, ID di
// installazione, aggiornamenti. Solo nella postazione locale (Electron): da
// browser in rete non ci sono.

export type UpdateState =
  | { readonly status: "unsupported" }
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "upToDate"; readonly checkedAt: string }
  | { readonly status: "downloading"; readonly version: string; readonly percent: number }
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "error"; readonly checkedAt: string };

export interface AppInfo {
  readonly version: string;
  readonly installationId: string | undefined;
  readonly autoCheckUpdates: boolean;
  /** L'avvio guidato e' gia' stato visto o saltato su questo computer. */
  readonly welcomeSeen: boolean;
  readonly update: UpdateState;
}

/** Esito di "Installa e riavvia". */
export type InstallResult = "installing" | "onAir" | "notReady" | "cancelled";

export interface DesktopApp {
  readonly appInfo: () => Promise<AppInfo>;
  readonly setWelcomeSeen: () => Promise<void>;
  readonly setAutoCheckUpdates: (on: boolean) => Promise<void>;
  readonly resetInstallationId: () => Promise<string>;
  readonly checkUpdates: () => Promise<void>;
  readonly installUpdate: () => Promise<InstallResult>;
  readonly onUpdateState: (listener: (state: UpdateState) => void) => () => void;
}

const desktop = (): DesktopApp | undefined => window.cuelithDesktop;

/** Informazioni dell'app, aggiornate quando cambia lo stato degli aggiornamenti. */
export function useAppInfo(): {
  readonly info: AppInfo | undefined;
  readonly reload: () => void;
} {
  const [info, setInfo] = useState<AppInfo | undefined>();
  const reload = useCallback(() => {
    void desktop()?.appInfo().then(setInfo);
  }, []);
  useEffect(() => {
    const app = desktop();
    if (app === undefined) return;
    reload();
    return app.onUpdateState((update) => {
      setInfo((current) => (current === undefined ? current : { ...current, update }));
    });
  }, [reload]);
  return { info, reload };
}

/**
 * Versione pronta da installare, se c'e'. `onReady` e' chiamata una volta
 * per versione, quando il download finisce (avviso all'operatore).
 */
export function useUpdateReady(onReady: (version: string) => void): string | undefined {
  const [ready, setReady] = useState<string | undefined>();
  const announced = useRef<string | undefined>(undefined);
  const latest = useRef(onReady);
  useEffect(() => {
    latest.current = onReady;
  });
  useEffect(() => {
    const app = desktop();
    if (app === undefined) return;
    const seen = (state: UpdateState) => {
      const version = state.status === "ready" ? state.version : undefined;
      setReady(version);
      if (version !== undefined && announced.current !== version) {
        announced.current = version;
        latest.current(version);
      }
    };
    void app.appInfo().then((info) => {
      seen(info.update);
    });
    return app.onUpdateState(seen);
  }, []);
  return ready;
}
