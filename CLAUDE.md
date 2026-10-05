# cuelith-core

Il contenitore di Cuelith: motore live, applicazione desktop (Electron), postazione (React) e uscite.

**Fonte di verità**: il documento di progetto nel repo `cuelith-docs` (Parte V, specifica tecnica). Le regole "Deciso" si seguono alla lettera; le "Proposta" si cambiano solo dopo conferma del fondatore. Il contratto con postazioni e moduli è `@cuelith/protocol` in `cuelith-sdk`: qui non si inventano metodi, tipi o eventi, si aggiungono lì.

## Struttura

- `apps/engine` — motore (Node puro, senza Electron): stato dello show, comandi, moduli, server HTTP + WebSocket (`/rpc`) su `127.0.0.1:7420`. Unica fonte di verità. I moduli con codice girano in processi separati (`src/modules/supervisor.ts`, decisione 0007): permessi di Node + controllo della rete (`sandbox.ts`), JSON-RPC su stdio (`process.ts`), riavvii 3 in 60 s, risposta entro 5 s. File `.cuelith` e copia automatica in `src/show/`; librerie e archivio (SQLite `node:sqlite`, `library.sqlite` nella cartella dati) e archivio media (`media/`, nomi = SHA-256) in `src/library/`. I comandi che toccano file del computer del motore sono solo per la postazione locale.
- `apps/desktop` — Electron: avvia il motore, apre la postazione (`http://127.0.0.1:<porta>/`) e una finestra per ogni uscita display (`src/outputs.ts`: monitor scelto, schermo intero o finestra; monitor scollegato = uscita in errore e riapertura automatica al ritorno). Preload in sandbox che consegna le credenziali solo alle finestre del motore: regia alla postazione, sola lettura alle uscite.
- `apps/renderer` — finestre di uscita (PixiJS, WebGL): `src/frame.ts` decide cosa mostrare (logica pura, provata a parte), `src/painter.ts` disegna. Eseguono solo lo stato ricevuto; mai messaggi d'errore al pubblico.
- `apps/client` — postazione React + Vite + Tailwind 4, servita dal motore (anche da browser in rete locale).
- `packages/core-looks` — look Sala e Palco del nucleo.
- `packages/engine-client` — collegamento al motore (presentazione, accesso, patch in ordine, ricollegamento) condiviso da postazione e uscite.
- `e2e` — Playwright avvia l'app Electron vera, agisce come l'operatore e salva screenshot in `e2e/screenshots/`.

## Regole

- **Repo affiancati**: `cuelith-sdk` e `plugin-locale-it` devono stare nella stessa cartella di `cuelith-core` (per le prove e2e anche `plugin-songs` e `plugin-template`, costruiti con `pnpm build`) (dipendenze `link:../../../cuelith-sdk/...`, lingua italiana preinstallata letta da `../plugin-locale-it`). Dopo una modifica all'SDK: `pnpm build` in `cuelith-sdk`.
- **Nessun testo nel codice**: solo chiavi (`core.*`) tradotte dal modulo lingua. Una chiave nuova si aggiunge anche a `plugin-locale-it/locales/it.json`.
- **Nessuna risorsa esterna**: font e file inclusi nel pacchetto, serviti dal motore. La CSP del motore blocca tutto il resto (anche i `data:` per font e script: per questo Vite ha `assetsInlineLimit: 0`).
- **Le modalità sono layout dichiarativi** (`src/modes/core.ts`) validati con lo schema dei moduli; il nucleo non ha percorsi privilegiati.
- **Verifica dell'interfaccia**: ogni cambiamento visibile si prova con `pnpm e2e` e si guardano gli screenshot, confrontandoli col documento.
- `ELECTRON_RUN_AS_NODE` (impostato dai processi delle estensioni di VS Code) fa partire Electron come Node: `pnpm start` ed e2e lo tolgono da soli. Il motore invece lo usa apposta per avviare i moduli Node con l'Electron incluso: nei pacchetti il "fuse" RunAsNode deve restare acceso.
- **Postazioni in rete** (decisione 0009): `apps/engine/src/network.ts` apre un secondo ascolto sull'indirizzo scelto (porta 7420) che passa tutto al server locale; abbinamento e token in `auth.ts`; aprire la rete, abbinare e revocare solo dalla postazione locale (`requireLocal`). La postazione da browser non ha `window.cuelithDesktop`: schermata di abbinamento (`shell/Pairing.tsx`), vista telecomando (`shell/RemoteView.tsx`), `useCan(scope)` nasconde cio' che il ruolo non puo' usare. Nelle prove un secondo Electron fa da browser (`e2e/browser`, indirizzo via variabile d'ambiente: come argomento non parte).
- **Le uscite non cadono**: nessun modulo gira dentro il motore o le uscite. La prova `e2e/tests/processes.spec.ts` uccide il processo di un modulo durante la proiezione e misura i fotogrammi: non si rompe per nessun motivo.
- Le decisioni prese durante il lavoro stanno in `cuelith-docs/decisioni/` e valgono come il documento.
- Prima di ogni commit: `pnpm check` e `pnpm exec prettier --check .` verdi, e `pnpm e2e` se è cambiata l'interfaccia o l'app desktop.
- Lavoro su `dev`; `main` riceve solo release taggate (SemVer).
- **Licenza** (decisione 0012): il nucleo è GPL 3.0 o successiva con l'eccezione per i plugin (`PLUGIN-EXCEPTION.md`). Una dipendenza nuova va controllata (`pnpm licenses list`): niente licenze incompatibili con la GPLv3. Il nucleo non incorpora mai codice di plugin di terzi, e i plugin non importano mai codice di `apps/*` o `packages/*` del nucleo: parlano solo con protocollo e SDK. Il codice dell'SDK è Apache 2.0 e resta nel suo repo: non si sposta codice del nucleo nell'SDK. Il nome «Cuelith» non è nella licenza (README, `TRADEMARK.md`).

## Comandi

```bash
pnpm install
pnpm build            # motore, postazione, app desktop
pnpm start            # apre Cuelith
pnpm check            # typecheck, lint, test
pnpm e2e              # build + prove con l'app vera
pnpm -C apps/desktop run dist:dir   # app impacchettata in apps/desktop/pack/release (senza installatore)
pnpm -C apps/desktop run dist       # installatore (Windows: NSIS; Linux: AppImage)
```

## Installatori e aggiornamenti (decisione 0004)

- L'app installata non ha `node_modules`: `vite.pack.config.ts` mette processo principale, motore e dipendenze in `pack/app/main.mjs`; `scripts/stage.mjs` aggiunge preload, postazione, uscite, stili e font; le lingue italiana e inglese vanno in `resources/plugins`. Per questo le dipendenze di `apps/desktop` sono tutte `devDependencies` (electron-builder impacchetterebbe le `dependencies`).
- Prove sull'app impacchettata: `CUELITH_E2E_EXECUTABLE=<eseguibile> pnpm -C e2e exec playwright test` (la CI lo fa su Linux a ogni push).
- Release: prima si scrivono le note in `versioni/X.Y.Z.md` (italiano, una riga `---`, inglese: il sito le divide lì); poi tag `vX.Y.Z` su `main` (uguale a `apps/desktop/package.json`) → `release.yml` crea la release in bozza con quelle note, carica gli installatori e la rende pubblica solo quando ci sono tutti; l'app li trova con electron-updater (`src/updates.ts`): scarica da sola, installa solo su richiesta dell'operatore e mai in onda (`isOnAir`).
- ID di installazione e preferenze in `src/installation.ts` (cartella dati): l'ID non viene inviato a nessuno.
