import { useEffect } from "react";
import { useEngine, useT } from "./engine/react.js";
import { Shell } from "./shell/Shell.js";

/**
 * Schermata di avvio (public/splash.css): identica a quella che Electron
 * mostra mentre parte il motore, con sotto lo stato del collegamento.
 */
function Splash({ status, busy }: { status: string; busy: boolean }) {
  return (
    <div className="cl-splash">
      <img className="cl-splash__logo" src="/brand/cuelith-logo.png" alt="Cuelith" />
      <div className="cl-splash__bar" style={busy ? undefined : { visibility: "hidden" }} />
      <p role="status" className="cl-splash__status">
        {status}
      </p>
    </div>
  );
}

export function App() {
  const t = useT();
  const { status, state, lang } = useEngine();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  if (status.kind === "incompatible") {
    return (
      <Splash
        busy={false}
        status={t("core.connection.incompatible", { engine: status.engineProtocol })}
      />
    );
  }
  if (status.kind === "unpaired") {
    return <Splash busy={false} status={t("core.pairing.required")} />;
  }
  if (state === undefined) {
    return <Splash busy status={t("core.connection.connecting")} />;
  }
  return <Shell />;
}
