# Cuelith Plugin Exception

**Additional permission under section 7 of the GNU General Public License, version 3.**

Cuelith is free software under the GNU General Public License, version 3 or (at your option) any later version (see [LICENSE](LICENSE)). This file adds a permission to it, as section 7 of that licence allows. It is part of the licence notice of Cuelith.

## The permission

As a special exception, the copyright holders of Cuelith give you permission to create, use, convey and sell a **Plugin** under **any licence terms you choose, including proprietary and commercial terms**, and to convey it together with Cuelith, without Cuelith's licence applying to the Plugin.

In particular, a Plugin that stays within the definition below is **not** a work based on Cuelith, and conveying it with Cuelith is mere aggregation in the sense of section 5 of the GNU General Public License.

## What counts as a Plugin

A **Plugin** is a work that extends Cuelith and works with it **only** through the public plugin interface, which is:

1. **The plugin protocol**: the messages (JSON) a Plugin and Cuelith exchange between separate processes, as specified in the Cuelith documentation (`cuelith-docs`) and in the schemas of the Cuelith SDK.
2. **The SDK**: the packages published in the repository [`cuelith-sdk`](https://github.com/Cuelith/cuelith-sdk), which are licensed separately (Apache License 2.0) and may be included in a Plugin.
3. **Panels**: the user interface a Plugin supplies and that Cuelith shows in an isolated, sandboxed frame, which talks to Cuelith only through messages over the SDK.
4. **Plugin data**: the manifest (`cuelith-plugin.json`), the package (`.cpkg`), icons, locale files and any other file a Plugin brings with it.

A Plugin does not count as such, and this exception does not cover it, if it contains or links to code taken from the Cuelith program itself (the files of the `cuelith-core` repository, other than the SDK), or if it loads Cuelith's code into its own process.

## What stays the same

- **Cuelith itself stays free software.** Anyone who conveys Cuelith, modified or not, must do so under the GNU General Public License and give the recipients the source code. This exception does not change that.
- **Modified versions of Cuelith.** If you modify Cuelith itself, the permission above applies to your modified version only if you leave this exception in place. You may remove it from your modified version (GNU General Public License, section 7); you are not obliged to keep it.
- **The name and the logo.** As section 7(e) of the GNU General Public License allows, no right is granted to use the name "Cuelith" or the Cuelith logo as trade names, trademarks or service marks, other than the uses listed in [TRADEMARK.md](https://github.com/Cuelith/.github/blob/main/TRADEMARK.md) (for example, saying that a Plugin is "for Cuelith").
- **No warranty and no endorsement.** Plugins are the work and the responsibility of their authors. Cuelith does not review, guarantee or sell them, whatever the licence.

---

**In italiano (riassunto, vale il testo inglese).** Cuelith è software libero con licenza GNU GPL versione 3 o successiva. Questo foglio aggiunge un permesso: i **plugin** che dialogano con Cuelith solo tramite l'interfaccia pubblica (il protocollo a messaggi tra processi separati, l'SDK, i pannelli mostrati in una cornice isolata, i loro file di dati) sono opere indipendenti. Chi li scrive può darli con la licenza che vuole, anche chiusa e a pagamento, e può distribuirli insieme a Cuelith. Il permesso non copre un plugin che contiene o carica codice del nucleo. Il nucleo resta libero: chi lo distribuisce, anche modificato, deve farlo sotto GPL e dare il sorgente. Il nome «Cuelith» e il logo restano protetti (vedi [TRADEMARK.md](https://github.com/Cuelith/.github/blob/main/TRADEMARK.md)).
