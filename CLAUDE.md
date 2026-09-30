# cuelith-core

Il contenitore di Cuelith: motore live, applicazione desktop (Electron), postazione (React) e uscite.

**Fonte di verità**: il documento di progetto nel repo `cuelith-docs` (Parte V, specifica tecnica). Le regole "Deciso" si seguono alla lettera; le "Proposta" si cambiano solo dopo conferma del fondatore. Il contratto con postazioni e moduli è `@cuelith/protocol` in `cuelith-sdk`: qui non si inventano metodi, tipi o eventi, si aggiungono lì.

## Struttura

- `apps/engine` — motore (Node puro, senza Electron): stato dello show, comandi, moduli, server HTTP + WebSocket (`/rpc`) su `127.0.0.1:7420`. Unica fonte di verità. File `.cuelith` e copia automatica in `src/show/`; librerie e archivio (SQLite `node:sqlite`, `library.sqlite` nella cartella dati) e archivio media (`media/`, nomi = SHA-256) in `src/library/`. I comandi che toccano file del computer del motore sono solo per la postazione locale.
- `apps/desktop` — Electron: avvia il motore, apre la postazione (`http://127.0.0.1:<porta>/`) e una finestra per ogni uscita display (`src/outputs.ts`: monitor scelto, schermo intero o finestra; monitor scollegato = uscita in errore e riapertura automatica al ritorno). Preload in sandbox che consegna le credenziali solo alle finestre del motore: regia alla postazione, sola lettura alle uscite.
- `apps/renderer` — finestre di uscita (PixiJS, WebGL): `src/frame.ts` decide cosa mostrare (logica pura, provata a parte), `src/painter.ts` disegna. Eseguono solo lo stato ricevuto; mai messaggi d'errore al pubblico.
- `apps/client` — postazione React + Vite + Tailwind 4, servita dal motore (anche da browser in rete locale).
- `packages/core-looks` — look Sala e Palco del nucleo.
- `packages/engine-client` — collegamento al motore (presentazione, accesso, patch in ordine, ricollegamento) condiviso da postazione e uscite.
- `e2e` — Playwright avvia l'app Electron vera, agisce come l'operatore e salva screenshot in `e2e/screenshots/`.

## Regole

- **Repo affiancati**: `cuelith-sdk` e `plugin-locale-it` devono stare nella stessa cartella di `cuelith-core` (dipendenze `link:../../../cuelith-sdk/...`, lingua italiana preinstallata letta da `../plugin-locale-it`). Dopo una modifica all'SDK: `pnpm build` in `cuelith-sdk`.
- **Nessun testo nel codice**: solo chiavi (`core.*`) tradotte dal modulo lingua. Una chiave nuova si aggiunge anche a `plugin-locale-it/locales/it.json`.
- **Nessuna risorsa esterna**: font e file inclusi nel pacchetto, serviti dal motore. La CSP del motore blocca tutto il resto (anche i `data:` per font e script: per questo Vite ha `assetsInlineLimit: 0`).
- **Le modalità sono layout dichiarativi** (`src/modes/core.ts`) validati con lo schema dei moduli; il nucleo non ha percorsi privilegiati.
- **Verifica dell'interfaccia**: ogni cambiamento visibile si prova con `pnpm e2e` e si guardano gli screenshot, confrontandoli col documento.
- `ELECTRON_RUN_AS_NODE` (impostato dai processi delle estensioni di VS Code) fa partire Electron come Node: `pnpm start` ed e2e lo tolgono da soli.
- Le decisioni prese durante il lavoro stanno in `cuelith-docs/decisioni/` e valgono come il documento.
- Prima di ogni commit: `pnpm check` e `pnpm exec prettier --check .` verdi, e `pnpm e2e` se è cambiata l'interfaccia o l'app desktop.
- Lavoro su `dev`; `main` riceve solo release taggate (SemVer).

## Comandi

```bash
pnpm install
pnpm build            # motore, postazione, app desktop
pnpm start            # apre Cuelith
pnpm check            # typecheck, lint, test
pnpm e2e              # build + prove con l'app vera
```
