import { useEffect, type ReactNode } from "react";
import { useEngine, useT } from "./engine/react.js";
import { Shell } from "./shell/Shell.js";
import { BrandMark } from "./shell/TopBar.js";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      {children}
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
      <Centered>
        <BrandMark size={40} />
        <p className="max-w-md text-muted">
          {t("core.connection.incompatible", { engine: status.engineProtocol })}
        </p>
      </Centered>
    );
  }
  if (status.kind === "unpaired") {
    return (
      <Centered>
        <BrandMark size={40} />
        <p className="max-w-md text-muted">{t("core.pairing.required")}</p>
      </Centered>
    );
  }
  if (state === undefined) {
    return (
      <Centered>
        <BrandMark size={40} />
        <p role="status" className="text-sm text-faint">
          {t("core.connection.connecting")}
        </p>
      </Centered>
    );
  }
  return <Shell />;
}
