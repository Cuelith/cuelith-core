import type { PluginManifest } from "@cuelith/protocol";
import { useState } from "react";
import { useT } from "../../engine/react.js";
import { Button } from "../../ui/Button.js";
import { ModalDialog } from "../../ui/Dialogs.js";

/**
 * Guida al primo uso di un modulo: i passi del suo manifest, con i testi
 * tradotti dal modulo stesso. Si apre dopo l'installazione e dai moduli installati.
 */
export function OnboardingDialog({
  manifest,
  onClose,
}: {
  manifest: PluginManifest;
  onClose: () => void;
}) {
  const t = useT();
  const steps = manifest.onboarding ?? [];
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (step === undefined) return null;
  const last = index === steps.length - 1;

  return (
    <ModalDialog
      title={t("core.modules.guideTitle", { name: manifest.name })}
      onClose={onClose}
      wide
    >
      {(close) => (
        <div className="flex flex-col gap-4 p-5">
          <p className="font-mono text-xs text-faint">
            {t("core.modules.guideStep", { n: index + 1, count: steps.length })}
          </p>
          <h3 className="font-display text-xl font-semibold">{t(step.title)}</h3>
          {step.image !== undefined && (
            <img
              src={`/plugins/${manifest.id}/${manifest.version}/${step.image}`}
              alt=""
              className="max-h-64 rounded-lg border border-line object-contain"
            />
          )}
          <p className="whitespace-pre-line text-sm text-muted">{t(step.body)}</p>
          <div className="flex justify-between gap-2">
            <Button
              disabled={index === 0}
              onClick={() => {
                setIndex(index - 1);
              }}
            >
              {t("core.modules.guidePrev")}
            </Button>
            {last ? (
              <Button tone="primary" onClick={close}>
                {t("core.modules.guideDone")}
              </Button>
            ) : (
              <Button
                tone="primary"
                onClick={() => {
                  setIndex(index + 1);
                }}
              >
                {t("core.modules.guideNext")}
              </Button>
            )}
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
