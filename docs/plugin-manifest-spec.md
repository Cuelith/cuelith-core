# Specifica del manifest plugin (bozza — Fase 3)

Ogni plugin di Cuelith è una cartella (o un file `.zip` con lo stesso contenuto) che contiene almeno un file `manifest.json` nella radice. Questo documento è una bozza di riferimento per quando verrà implementato il plugin host (Fase 3): la forma può ancora cambiare.

## Struttura di un pacchetto plugin

```
mio-plugin/
  manifest.json     obbligatorio
  index.html         solo se il plugin ha una UI (pannello)
  logic.wasm          solo se il plugin ha logica compilata in WebAssembly
  assets/               risorse statiche del plugin (icone, font, ecc.)
```

## Due tipi di plugin

Ogni plugin dichiara un `kind`, che determina come si presenta nell'interfaccia:

- **`service`** — gira in background, senza un pannello di contenuto: protocolli e integrazioni (trigger MIDI/OSC, output NDI, un futuro server per il controllo remoto). Non contribuisce un pulsante nella barra "aggiungi contenuto". Può comunque avere una piccola UI di **configurazione** (es. porta MIDI, indirizzo IP) — quella non è un pannello di contenuto, è un modulo di impostazioni.
- **`panel`** — contribuisce contenuto allo show tramite un pulsante nella barra "aggiungi contenuto" (es. "+ Versetto") che apre un pannello sandboxato (Bibbia, Canzoniere, Import presentazioni).

Questa distinzione è solo per l'interfaccia: a livello tecnico entrambi sono lo stesso pacchetto (manifest + eventuale `ui.entry` + eventuale `logic.wasm`); un plugin `service` semplicemente non dichiara `composer_button`.

## Campi del manifest

```json
{
  "id": "it.lzrhive.cuelith.plugin.bible",
  "name": "Bibbia",
  "version": "1.0.0",
  "description": "Ricerca e inserimento di versetti biblici come cue.",
  "author": "Nome Autore",
  "license": "Apache-2.0",
  "min_host_version": "0.1.0",
  "max_host_version": null,
  "kind": "panel",
  "category": ["religioso"],
  "permissions": ["show.read", "show.write", "storage.read"],
  "ui": {
    "entry": "index.html"
  },
  "composer_button": {
    "label": "Versetto"
  },
  "settings": {
    "entry": "settings.html"
  },
  "onboarding": [
    { "title": "Scarica una traduzione", "body": "Prima di cercare un versetto, scarica almeno una traduzione dal catalogo qui sotto." },
    { "title": "Cerca un passo", "body": "Usa \"+ Versetto\" nella barra sopra la scaletta: scegli libro, capitolo e versetti, oppure scrivi il riferimento a mano." },
    { "title": "Decidi come appare", "body": "Scegli se dividerlo in più slide e se mostrare il riferimento sulla proiezione." }
  ],
  "docs": {
    "entry": "docs.html"
  },
  "logic": {
    "wasm": "logic.wasm"
  }
}
```

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `id` | sì | Identificatore univoco in stile reverse-DNS. Usato per cartelle dati, aggiornamenti, disinstallazione. |
| `name` | sì | Nome visualizzato nell'interfaccia e nel Plugin Store. |
| `version` | sì | Versione semver del plugin. |
| `description` | sì | Descrizione breve mostrata nel Plugin Store. |
| `author` | no | Nome o organizzazione dell'autore. |
| `license` | no | Licenza del codice del plugin. |
| `min_host_version` | sì | Versione minima di Cuelith richiesta. Sotto questa versione il plugin non è nemmeno installabile. |
| `max_host_version` | no | Se impostata, versione massima testata: oltre, il Plugin Store mostra un avviso "non ancora verificato" invece di bloccare l'installazione. |
| `kind` | sì | `service` o `panel` — vedi sopra. Determina l'icona e la sezione in cui compare nel Plugin Store e nella pagina di gestione. |
| `category` | sì | Una o più categorie d'uso (es. `religioso`, `corporate`, `teatro`, `generico`) — usate dal Plugin Store per aiutare l'utente a trovare solo ciò che gli serve. |
| `permissions` | sì (può essere vuoto) | Elenco di permessi richiesti, concessi esplicitamente dall'utente all'installazione. Nessun permesso di default. |
| `ui.entry` | no | Pagina HTML caricata in iframe sandboxato come pannello di contenuto (plugin `panel`). |
| `composer_button` | no | Se presente, la label del pulsante aggiunto alla barra "aggiungi contenuto" che apre `ui.entry`. Solo per plugin `panel`. |
| `settings.entry` | no | Pagina HTML per la configurazione del plugin (porta MIDI, cartella di un import, ecc.), raggiungibile dalla pagina di gestione. Ha senso soprattutto per i plugin `service`, ma qualunque plugin può averla. |
| `onboarding` | no, ma fortemente raccomandato | Elenco di passi brevi (titolo + corpo) mostrati una sola volta, come overlay, subito dopo l'installazione, prima del primo utilizzo. |
| `docs.entry` | no, ma fortemente raccomandato | Pagina HTML di documentazione completa, sempre raggiungibile in un secondo momento dalla pagina di gestione plugin (bottone "Documentazione" su ogni riga). A differenza di `onboarding`, non scompare dopo la prima volta. |
| `logic.wasm` | no | Modulo WebAssembly eseguito in sandbox dal plugin host. Omesso se il plugin è solo UI. |

Un plugin deve avere almeno uno tra `ui.entry` e `logic.wasm`. `onboarding` e `docs.entry` sono facoltativi solo tecnicamente: un plugin senza nessuno dei due passa la revisione del registro (Fase 4) solo con un avviso esplicito, perché l'obiettivo è che ogni plugin, arrivando da autori diversi, si spieghi da solo tanto quanto uno curato dal progetto.

## Permessi (bozza)

I permessi seguono lo schema `area.azione`. Elenco iniziale previsto:

- `show.read` — leggere lo Show corrente e i suoi cue
- `show.write` — aggiungere/modificare/rimuovere cue nello Show corrente
- `storage.read` — leggere dati salvati dal plugin stesso (namespace isolato per `id`)
- `storage.write` — scrivere dati nel proprio namespace
- `network.fetch` — effettuare richieste HTTP verso host dichiarati esplicitamente nel manifest

Un plugin non può mai accedere ai dati o al namespace di storage di un altro plugin, né al filesystem al di fuori della propria cartella dati.

## Comunicazione plugin UI ↔ core

I pannelli plugin girano in un `<iframe>` sandboxato (`sandbox="allow-scripts"`, nessun `allow-same-origin` verso l'app host) e comunicano esclusivamente tramite `postMessage`, con un bridge JS (`plugin-bridge.ts`) che:

1. Verifica che il messaggio arrivi dall'iframe atteso.
2. Controlla che l'azione richiesta rientri nei `permissions` dichiarati dal plugin nel manifest.
3. Inoltra la richiesta autorizzata a un comando Tauri corrispondente.
4. Restituisce il risultato (o un errore) al plugin via `postMessage`.

## Repository: un plugin, un repo

Ogni plugin ha il proprio repository GitHub, separato dal core, sotto la stessa organizzazione (`github.com/cuelith`):

```
github.com/cuelith/cuelith          il core — questo repo, nessun contenuto di dominio
github.com/cuelith/plugin-bible     tutto il plugin Bibbia: codice, issue, release
github.com/cuelith/plugin-songs     tutto il plugin Canzoniere
github.com/cuelith/plugin-ndi       tutto il plugin Output NDI
```

Ogni release GitHub del repo di un plugin pubblica lo zip installabile (manifest + `ui/`, `logic.wasm`, ecc. — la struttura descritta sopra). Il core non contiene mai codice di un plugin, nemmeno di quelli "ufficiali": anche Bibbia o Canzoniere, per quanto mantenuti dallo stesso progetto, passano dal registro come qualunque plugin di terze parti — è la stessa via, non una scorciatoia interna.

## Registro plugin (Fase 4)

Il registro è un repo GitHub pubblico (`github.com/cuelith/registry`, oppure una cartella dentro il core — da decidere in Fase 4) con un file `index.json` che elenca i plugin **senza contenerne il codice**, solo puntatori alle release dei rispettivi repo:

```json
{
  "plugins": [
    {
      "id": "it.lzrhive.cuelith.plugin.bible",
      "name": "Bibbia",
      "latest_version": "1.0.0",
      "category": ["religioso"],
      "repo": "cuelith/plugin-bible",
      "download_url": "https://github.com/cuelith/plugin-bible/releases/download/v1.0.0/bible.zip",
      "checksum_sha256": "..."
    }
  ]
}
```

L'app scarica `index.json`, lo mostra nel Plugin Store filtrabile per categoria, e all'installazione scarica il pacchetto, verifica il checksum, lo estrae nella cartella dati locale dei plugin e lo monta senza richiedere il riavvio dell'applicazione.

Ogni card nel Plugin Store mostra anche un'indicazione di compatibilità, calcolata confrontando `min_host_version`/`max_host_version` con la versione di Cuelith installata: "Compatibile", "Richiede l'aggiornamento di Cuelith" (sotto `min_host_version`, installazione bloccata), o "Non ancora verificato con questa versione" (sopra `max_host_version`, installazione permessa ma con avviso).
