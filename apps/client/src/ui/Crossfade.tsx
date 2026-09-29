import { useState, type ReactNode } from "react";

/**
 * Dissolvenza incrociata tra un contenuto e il successivo, con la durata
 * della transizione del look. Il contenuto e' un valore dello stato (non un
 * nodo React): cosi' quello che esce resta esattamente com'era in onda.
 * `value` deve avere un riferimento stabile finche' non cambia.
 */
export function Crossfade<T>({
  value,
  keyOf,
  durationMs,
  render,
}: {
  value: T;
  keyOf: (value: T) => string;
  durationMs: number;
  render: (value: T) => ReactNode;
}) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<{ value: T } | undefined>();

  // Stato derivato dal render precedente (schema consigliato da React).
  if (shown !== value) {
    if (keyOf(shown) !== keyOf(value)) setLeaving(durationMs > 0 ? { value: shown } : undefined);
    setShown(value);
  }

  const duration = `${String(durationMs)}ms`;
  return (
    <div className="absolute inset-0" data-transition-ms={durationMs}>
      {leaving !== undefined && (
        <div
          key={`out:${keyOf(leaving.value)}`}
          className="cl-fade-out absolute inset-0"
          style={{ animationDuration: duration }}
          onAnimationEnd={() => {
            setLeaving(undefined);
          }}
        >
          {render(leaving.value)}
        </div>
      )}
      <div
        key={`in:${keyOf(value)}`}
        className="cl-fade-in absolute inset-0"
        style={{ animationDuration: leaving === undefined ? "0ms" : duration }}
      >
        {render(value)}
      </div>
    </div>
  );
}
