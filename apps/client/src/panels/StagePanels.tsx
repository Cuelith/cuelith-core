import {
  formatTimer,
  timerPhase,
  timerRemaining,
  type StateDocument,
  type Timer,
} from "@cuelith/protocol";
import { useEffect, useId, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { INPUT } from "../ui/Dialogs.js";
import { EmptyState, Panel } from "../ui/Panel.js";

/** Durate pronte per relatori e sessioni, in minuti. */
const PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;

const PHASE_CLASS = { ok: "text-cue", warning: "text-stage", danger: "text-live" } as const;

/** Si ridisegna da solo mentre il timer corre (4 volte al secondo). */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return now;
}

function TimerDisplay({ timer }: { timer: Timer }) {
  const now = useNow(timer.startedAt !== undefined);
  const remaining = timer.startedAt === undefined ? timer.remainingMs : timerRemaining(timer, now);
  return (
    <span
      data-testid="timer-display"
      data-phase={timerPhase(remaining)}
      className={`font-mono text-6xl font-bold tabular-nums ${PHASE_CLASS[timerPhase(remaining)]}`}
    >
      {formatTimer(remaining)}
    </span>
  );
}

function Clock() {
  const now = useNow(true);
  return (
    <span className="font-mono text-2xl tabular-nums">
      {new Date(now).toLocaleTimeString(document.documentElement.lang || undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  );
}

/**
 * Timer della regia (disposizione Conferenza): conto alla rovescia condiviso
 * con tutte le postazioni e mostrato sui monitor del palco. Colori come sui
 * timer da palco: verde, ambra sotto i 2 minuti, rosso sotto i 30 secondi e
 * oltre il tempo (conta in negativo).
 */
export function TimerPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const minutesId = useId();
  const [minutes, setMinutes] = useState("");
  const timer = state?.live.timer;
  const running = timer?.startedAt !== undefined;
  const custom = Number(minutes.replace(",", "."));
  return (
    <Panel label={t("core.panel.timer")}>
      <div className="flex flex-col items-center gap-1 rounded-xl border border-line bg-bg-2 p-4">
        {timer === undefined ? (
          <span className="text-sm text-muted">{t("core.timer.none")}</span>
        ) : (
          <TimerDisplay timer={timer} />
        )}
        {timer !== undefined && (
          <span className="text-xs text-faint">
            {t("core.timer.of", { total: formatTimer(timer.durationMs) })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("core.timer.presets")}>
        {PRESETS.map((value) => (
          <Button
            key={value}
            size="sm"
            onClick={() => void run("timer.set", { durationMs: value * 60_000 })}
          >
            {t("core.timer.minutes", { n: value })}
          </Button>
        ))}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isFinite(custom) || custom <= 0) return;
          void run("timer.set", { durationMs: Math.round(custom * 60_000) });
          setMinutes("");
        }}
      >
        <label htmlFor={minutesId} className="text-xs text-muted">
          {t("core.timer.custom")}
        </label>
        <input
          id={minutesId}
          inputMode="decimal"
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
          }}
          className={`${INPUT} w-20 py-1`}
        />
        <Button size="sm" type="submit" disabled={!Number.isFinite(custom) || custom <= 0}>
          {t("core.timer.set")}
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        <Button
          tone="primary"
          disabled={timer === undefined}
          onClick={() => void run(running ? "timer.pause" : "timer.start", {})}
        >
          {t(running ? "core.timer.pause" : "core.timer.start")}
        </Button>
        <Button disabled={timer === undefined} onClick={() => void run("timer.reset", {})}>
          {t("core.timer.reset")}
        </Button>
        <Button disabled={timer === undefined} onClick={() => void run("timer.clear", {})}>
          {t("core.timer.clear")}
        </Button>
      </div>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {t("core.timer.clock")}
        </span>
        <Clock />
      </div>
    </Panel>
  );
}

/** Uscite del palco (look Palco); se non ce ne sono, tutte. */
function stageOutputs(doc: StateDocument): { id: string; name: string }[] {
  const all = Object.values(doc.show.outputs);
  const stage = all.filter((output) => {
    if (output.feed.type !== "source") return false;
    const look = output.feed.lookId === undefined ? undefined : doc.show.looks[output.feed.lookId];
    return look?.template === "core.stage";
  });
  return (stage.length > 0 ? stage : all).map((o) => ({ id: o.id, name: o.name }));
}

/**
 * Messaggio ai monitor del palco (disposizioni Band e Conferenza): al relatore
 * o ai musicisti, senza che il pubblico lo veda.
 */
export function StagePanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const textId = useId();
  const [text, setText] = useState("");
  if (state === undefined) return null;
  const targets = stageOutputs(state);
  const current = targets
    .map((o) => state.live.outputs[o.id]?.message)
    .find((m) => m !== undefined && m !== "");
  const send = (message: string) => {
    for (const output of targets) void run("message.send", { outputId: output.id, text: message });
  };
  if (targets.length === 0) {
    return (
      <Panel label={t("core.panel.stage")}>
        <EmptyState title={t("core.stage.noOutputs")} />
      </Panel>
    );
  }
  return (
    <Panel label={t("core.panel.stage")}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() === "") return;
          send(text);
        }}
      >
        <label htmlFor={textId} className="text-xs text-muted">
          {t("core.stage.to", { names: targets.map((o) => o.name).join(", ") })}
        </label>
        <input
          id={textId}
          value={text}
          maxLength={500}
          onChange={(event) => {
            setText(event.target.value);
          }}
          className={`${INPUT} py-2`}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button type="submit" tone="primary" disabled={text.trim() === ""}>
            {t("core.stage.send")}
          </Button>
          <Button
            disabled={current === undefined}
            onClick={() => {
              send("");
            }}
          >
            {t("core.stage.remove")}
          </Button>
        </div>
      </form>
      {current !== undefined && (
        <p
          data-testid="stage-current"
          className="rounded-lg border border-stage-line bg-stage-bg px-3 py-2 text-sm text-stage"
        >
          {current}
        </p>
      )}
    </Panel>
  );
}
