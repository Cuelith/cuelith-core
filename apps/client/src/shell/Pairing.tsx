import { EngineCallError } from "@cuelith-core/engine-client";
import { useId, useState } from "react";
import { useConnection, useT } from "../engine/react.js";
import { Button } from "../ui/Button.js";
import { INPUT } from "../ui/Dialogs.js";

/**
 * Abbinamento di una postazione in rete (cap. 9 e 23): si scrive il codice a
 * 6 cifre mostrato sul computer del motore e il nome di questa postazione.
 * Pensata anche per il telefono in verticale.
 */
export function PairingScreen() {
  const t = useT();
  const connection = useConnection();
  const id = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ready = /^\d{6}$/.test(code) && name.trim() !== "" && !busy;

  const pair = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await connection.pair(code, name.trim());
    } catch (cause) {
      setError(t(cause instanceof EngineCallError ? cause.message : "core.error.internal"));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-5 py-8">
      <img src="/brand/cuelith-logo.png" alt="Cuelith" className="h-10 w-auto self-start" />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">{t("core.pairing.title")}</h1>
        <p className="text-sm text-muted">{t("core.pairing.intro")}</p>
      </div>
      <label htmlFor={`${id}-code`} className="flex flex-col gap-1.5 text-sm">
        {t("core.pairing.code")}
        <input
          id={`${id}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void pair();
          }}
          className={`${INPUT} text-center font-mono text-2xl tracking-[0.4em]`}
        />
      </label>
      <label htmlFor={`${id}-name`} className="flex flex-col gap-1.5 text-sm">
        {t("core.pairing.name")}
        <input
          id={`${id}-name`}
          maxLength={80}
          value={name}
          placeholder={t("core.pairing.namePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void pair();
          }}
          className={INPUT}
        />
      </label>
      {error !== undefined && (
        <p role="alert" className="text-sm text-stage">
          {error}
        </p>
      )}
      <Button tone="primary" size="md" disabled={!ready} onClick={() => void pair()}>
        {t("core.pairing.pair")}
      </Button>
    </main>
  );
}
