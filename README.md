# Cuelith

Software di proiezione live, gratuito e open source: culti, conferenze, concerti, dirette, teatro e schermi informativi. Un nucleo leggero; tutto il resto si aggiunge come modulo.

Questo repository contiene il nucleo: il motore, l'applicazione desktop e la postazione dell'operatore. I moduli vivono ognuno nel suo repository dell'organizzazione [Cuelith](https://github.com/Cuelith).

> Stato: anteprima. Le fondamenta sono complete e provate in automatico; camera, scene e diretta arrivano con la prossima fase.

## Scaricare Cuelith

Dalla pagina delle [versioni](https://github.com/Cuelith/cuelith-core/releases/latest):

- **Windows**: `Cuelith-Setup-<versione>.exe`. Non serve l'amministratore. L'installatore non è firmato, quindi al primo avvio Windows può chiedere conferma: **Ulteriori informazioni → Esegui comunque**.
- **Linux**: `Cuelith-<versione>-x86_64.AppImage`.

Gli aggiornamenti si scaricano da soli e si installano solo quando lo decidi tu, mai mentre sei in onda.

## Provarlo dal codice

Servono [Node.js](https://nodejs.org) 24 e [pnpm](https://pnpm.io) 12. I repository vanno clonati affiancati nella stessa cartella:

```bash
git clone -b dev https://github.com/Cuelith/cuelith-sdk.git
git clone -b dev https://github.com/Cuelith/plugin-locale-it.git
git clone -b dev https://github.com/Cuelith/cuelith-core.git

cd cuelith-sdk && pnpm install && pnpm build && cd ..
cd cuelith-core && pnpm install && pnpm build && pnpm start
```

Al primo avvio viene scaricato l'eseguibile di Electron.

## Licenza

[Apache 2.0](LICENSE)
