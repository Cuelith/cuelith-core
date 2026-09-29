# Architettura di Cuelith

## Visione

Cuelith è un **contenitore** per la gestione di contenuti live su uno schermo esterno (proiettore, monitor, LED wall). Il core non sa nulla di alcun dominio specifico — non conosce la Bibbia, i canti, le slide aziendali o i sottopancia di un evento. Ogni funzionalità di contenuto è un **plugin**, installabile e rimovibile dall'interfaccia, senza riavviare l'applicazione.

Questo lo rende utilizzabile per qualsiasi contesto — funzioni religiose, eventi aziendali, conferenze, teatro, concerti — perché chi non ne ha bisogno semplicemente non installa un dato plugin.

## Ispirazione: cosa esiste già e cosa prendere da ciascuno

| Software | Punto di forza da riprendere | Limite da superare |
|---|---|---|
| **OpenLP** | Modello "service" (scaletta ordinata), open source | Pesante (Python/Qt), UI datata, plugin statici richiedono riavvio, pensato solo per il culto |
| **ProPresenter** | UI curatissima, stage display per chi è sul palco, timer/countdown integrati, store di contenuti | Chiuso, a pagamento, contenuti pensati per worship/eventi ma non davvero "contenitore neutro" |
| **QLab** | Modello a **cue** con trigger (non solo "avanti/indietro" ma segnali, timing, trigger esterni) — molto più professionale del semplice elenco lineare | Solo macOS, licenze costose per funzioni avanzate, nessun vero plugin store |
| **OBS Studio** | Il miglior esempio reale di "contenitore + plugin" open source: modello a scene/sorgenti, community enorme, cross-platform, plugin store integrato | Pensato per streaming/broadcasting, non per presentazione testi/scalette in stile "live show" |
| **Resolume Arena** | Gestione a clip/layer molto visuale, ottimo per VJ/concerti | Proprietario, costoso, poco adatto a contenuti testuali lunghi |
| **EasyWorship / Proclaim / MediaShout** | — | Chiusi, quasi tutti legati solo al mondo religioso o cloud-locked |
| **Chataigne** | Architettura "tutto è un modulo", forte su OSC/MIDI per il controllo | Pensato per il controllo/mapping, non per la presentazione di contenuti a schermo |

**Sintesi**: il modello a cue di QLab, il modello "contenitore + plugin store" di OBS Studio, la cura dell'esperienza operatore/palco di ProPresenter, l'estensibilità verso il controllo esterno (MIDI/OSC) di Chataigne — su un kernel Rust/Tauri leggero e davvero multipiattaforma.

## Concetti di dominio

- **Show**: il contenitore di un evento. Sostituisce il concetto stretto di "service" di OpenLP con qualcosa di neutro, applicabile a qualsiasi contesto. Vedi `src-tauri/src/core/show.rs`.
- **Cue**: unità elementare dentro uno Show. Ogni Cue referenzia contenuto prodotto da un plugin (`kind`) e porta un payload opaco al core. In futuro potrà portare metadati di trigger/timing (avanzamento a tempo, trigger MIDI/OSC), superando il semplice elenco lineare di OpenLP.
- **Live / Preview**: stato attualmente proiettato vs. stato in preparazione, prima di mandarlo "in onda".
- **Display/output surface**: finestra separata, senza bordi, a schermo intero, posizionabile sul monitor/proiettore scelto — disaccoppiata dalla finestra di controllo dell'operatore. Vedi `src-tauri/src/core/display.rs`. Pensata per essere estendibile in futuro (output NDI/streaming via plugin).
- **Tema**: stile visivo (sfondo, transizioni, font) applicabile in modo coerente al contenuto di qualunque plugin — i plugin forniscono contenuto strutturato, il kernel decide come renderizzarlo.

## Livelli del sistema

1. **Core engine** (Rust, `src-tauri/src/core/`): stato dello Show/Cue, gestione finestre di output multi-monitor, motore dei temi (da costruire in Fase 1), storage (Fase 2). Non contiene alcun tipo di contenuto specifico di dominio.
2. **Plugin host** (Rust, Fase 3): scoperta, installazione/rimozione a runtime, aggiornamento, permessi dei plugin; espone un'API limitata via comandi Tauri.
3. **UI shell** (web, `src/`, TypeScript + Svelte): finestra principale con pannelli per i contenuti, editor dello Show, preview/live, "Plugin Store".
4. **Storage locale** (Fase 2): SQLite (`rusqlite`) per libreria contenuti e impostazioni — nessun server, file singolo, portabile.

## Sistema di plugin (Fase 3+)

Nessuna libreria nativa (.dll/.so/.dylib): troppo fragile da compilare per ogni OS e rischiosa senza sandbox. Due tipi di plugin, entrambi pacchettizzati come cartella/zip con `manifest.json` (vedi `docs/plugin-manifest-spec.md`):

- **Plugin UI** (pannelli): bundle HTML/CSS/JS caricato in iframe sandboxato, comunica col core solo via bridge `postMessage` con permessi dichiarati nel manifest (es. `show.write`, `storage.read`).
- **Plugin logici** (parser, integrazioni esterne): compilati in WebAssembly, eseguiti in sandbox dal plugin host — stesso binario su tutti gli OS, nessun codice nativo arbitrario.

### Struttura multi-repo su GitHub

Il core e ogni plugin vivono in repository GitHub separati, sotto un'unica organizzazione (`github.com/cuelith`), non in un monorepo:

- `cuelith/cuelith` — il core (questo repo): il software con tutte le funzionalità di base, nessun contenuto di dominio.
- `cuelith/plugin-bible`, `cuelith/plugin-songs`, `cuelith/plugin-ndi`, ecc. — un repo per plugin, ognuno con la propria cronologia, versione e release GitHub.

Stesso modello delle estensioni di VS Code o dei plugin di Obsidian: un contributor esterno può proporre o mantenere un plugin senza bisogno di accesso al core, ogni plugin ha issue/versioning propri, e il core resta piccolo. Il registro (`index.json`, vedi `docs/plugin-manifest-spec.md`) è l'unico punto che li collega: elenca id, versione, categoria e `download_url` — che punta alla release GitHub del repo del plugin, non a una sottocartella del core. L'app scarica ed estrae il pacchetto localmente; i pannelli si montano dinamicamente, senza riavvio.

### Core bundle vs. plugin opzionali

Anche i contenuti "generici" sono plugin di prima parte, architetturalmente identici a quelli di terze parti, solo preinstallati di default:

- Testo/slide personalizzate, Immagini, Video/media, Timer/countdown, Pagina web (come le "browser source" di OBS)

Plugin di dominio, scaricabili solo se servono:

- Bibbia (uso religioso)
- Canzoniere/testi liturgici
- Import presentazioni (PowerPoint/PDF)
- Output NDI (broadcast/pro-AV)
- Input camera/webcam
- Sottopancia/grafica broadcast
- Trigger MIDI/OSC (teatro/eventi pro)

## Piano di lavoro (fasi)

- **Fase 0 (completata)**: scaffolding Tauri + Svelte, finestra principale, finestra di output (fullscreen senza bordi, selezione monitor), struct Rust minime per `Show`/`Cue`, documentazione.
- **Fase 1 (completata)**: contenuti "core bundle" (non ancora veri plugin) — testo/slide, immagini, editor dei cue con drag & drop, live/preview, temi.
- **Fase 2 (completata)**: storage SQLite — ogni show è un file `.cuelith` a sé (modello a documento, non libreria centrale), comandi Nuovo/Apri/Salva/Salva con nome. Le immagini restano referenziate per percorso assoluto, non copiate nel file: limite noto, da rivedere quando servirà davvero la portabilità tra macchine.
- **Fase 2.5 (completata)**: interfaccia ripensata dopo il primo giro di feedback — tre modalità operative intercambiabili (Doppio schermo, Lista di regia, Griglia), tema scuro coerente con gli strumenti del settore, tema/output spostati in un pannello Impostazioni a comparsa, scorciatoie da tastiera per operare senza mouse (Spazio manda in onda e arma il prossimo, frecce per navigare la preview, Esc ferma la diretta).
- **Fase 3**: architettura plugin concreta — bridge iframe, host WASM, installazione locale da cartella/zip; conversione dei "core bundle" della Fase 1 in veri plugin (dogfooding). I plugin vivranno in repo GitHub separati dal core (vedi sopra), non in questo repo.
- **Fase 4**: registro remoto su GitHub + UI "Plugin Store".
- **Fase 5**: primi plugin di dominio (es. Bibbia) come prova che l'API dei plugin è sufficiente; eventuale estensione verso trigger MIDI/OSC e output NDI.

## Stack tecnico

- **Core**: Rust + [Tauri 2](https://tauri.app) — binari piccoli, basso uso RAM, vero multipiattaforma (Windows/macOS/Linux).
- **UI shell**: SvelteKit (modalità SPA, `adapter-static`) + TypeScript.
- **Storage**: SQLite locale (`rusqlite`, feature `bundled`), un file `.cuelith` per show, nessun server.
- **Plugin**: WebAssembly (logica) + bundle web sandboxati in iframe (UI).
- **Distribuzione plugin**: indice JSON su repo GitHub pubblico, nessun backend da mantenere.
- **Licenza**: Apache 2.0.
