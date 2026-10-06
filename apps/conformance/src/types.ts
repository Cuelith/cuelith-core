export type Level = "error" | "warning";

/** Un problema trovato. `id` e' stabile: si cita nelle guide e nelle segnalazioni. */
export interface Finding {
  readonly id: string;
  readonly level: Level;
  readonly message: string;
  /** Come si risolve, in una frase. */
  readonly fix?: string;
  readonly file?: string;
}

export interface Report {
  readonly target: string;
  readonly pluginId?: string;
  readonly version?: string;
  /** Controlli eseguiti (anche quelli superati), per poterli elencare. */
  readonly checks: readonly string[];
  readonly findings: readonly Finding[];
  /** Vero se non c'e' nessun errore (gli avvisi non bloccano). */
  readonly ok: boolean;
}

export interface CheckOptions {
  /** Versione di Cuelith contro cui provare. */
  readonly coreVersion: string;
  /** Salta le prove con il motore vero (solo controlli statici). */
  readonly staticOnly?: boolean;
  /** Secondi in cui il plugin deve restare attivo senza cadere. */
  readonly stableSeconds?: number;
}

export class Collector {
  readonly checks: string[] = [];
  readonly findings: Finding[] = [];

  ran(id: string): void {
    if (!this.checks.includes(id)) this.checks.push(id);
  }

  add(finding: Finding): void {
    this.ran(finding.id);
    this.findings.push(finding);
  }

  report(target: string, pluginId?: string, version?: string): Report {
    return {
      target,
      ...(pluginId === undefined ? {} : { pluginId }),
      ...(version === undefined ? {} : { version }),
      checks: this.checks,
      findings: this.findings,
      ok: !this.findings.some((f) => f.level === "error"),
    };
  }
}
