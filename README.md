# Cuelith

Cuelith è un contenitore open source per la gestione di contenuti live su uno schermo esterno (proiettore, monitor, LED wall). Il core non conosce alcun dominio specifico: ogni funzionalità di contenuto — Bibbia, canzoniere, sottopancia, timer, output NDI, ecc. — è un plugin installabile dall'interfaccia, così chi non ne ha bisogno non lo scarica.

Adatto a qualsiasi contesto: funzioni religiose, eventi aziendali, conferenze, teatro, concerti.

Per l'architettura completa, l'ispirazione (OpenLP, ProPresenter, QLab, OBS Studio, Resolume, Chataigne) e il piano di lavoro, vedi [`docs/architettura.md`](docs/architettura.md). Per la specifica del formato plugin, vedi [`docs/plugin-manifest-spec.md`](docs/plugin-manifest-spec.md).

## Stack

- **Core**: Rust + [Tauri 2](https://tauri.app)
- **Interfaccia**: SvelteKit (SPA) + TypeScript
- **Plugin**: WebAssembly (logica) + bundle web sandboxati (UI)
- **Licenza**: Apache 2.0

## Sviluppo

Prerequisiti: [Node.js](https://nodejs.org), [Rust](https://www.rust-lang.org/tools/install) e, su Windows, i [Visual Studio Build Tools](https://tauri.app/start/prerequisites/) (workload "C++ build tools").

```bash
npm install
npm run tauri dev
```

Per compilare un pacchetto distribuibile:

```bash
npm run tauri build
```

## Stato del progetto

In sviluppo attivo, non ancora rilasciato. Funzionante: editor dello show (slide/immagini, drag & drop, tre modalità operative intercambiabili), preview/live con finestra di output multi-monitor, temi, salvataggio/apertura su file `.cuelith` (SQLite), scorciatoie da tastiera per operare senza mouse. Non ancora costruito: il sistema di plugin vero e proprio (oggi solo progettato, vedi `docs/plugin-manifest-spec.md`) — i contenuti attuali (slide, immagini) sono "core bundle" già pensati per diventare plugin, ma la parte che li installa/carica a runtime deve ancora essere scritta.

Il lavoro procede sul branch `dev`; `main` riceve solo le versioni rilasciate (vedi sotto).

## Versionamento

- `main` — solo versioni rilasciate, taggate (es. `v0.1.0-beta`), mai commit diretti.
- `dev` — lavoro in corso, tutti i commit quotidiani.
- Quando un giro di lavoro su `dev` è abbastanza completo da essere una versione, si fa merge su `main` con un tag [SemVer](https://semver.org): i tag restano per sempre nella cronologia, quindi ogni versione precedente resta scaricabile dalle [Release](https://github.com/Cuelith/Cuelith/releases) anche dopo — nessuna versione viene mai persa o sovrascritta.
