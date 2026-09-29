# Cuelith

Software di proiezione live, gratuito e open source: culti, conferenze, concerti, dirette, teatro e schermi informativi. Un nucleo leggero; tutto il resto si aggiunge come modulo.

Questo repository contiene il nucleo: il motore, l'applicazione desktop e la postazione dell'operatore. I moduli vivono ognuno nel suo repository dell'organizzazione [Cuelith](https://github.com/Cuelith).

> Stato: in sviluppo (Fase 0). Non ancora pronto per un evento dal vivo.

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
