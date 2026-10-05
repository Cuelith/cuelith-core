# Cuelith

Live projection software, free and open source: texts, lyrics and announcements on the projector, the stage monitor and every other screen. A small core; everything else is added as a plugin.

**Website and downloads: [cuelith.lzrhive.it](https://cuelith.lzrhive.it/en/)** · _[in italiano](https://cuelith.lzrhive.it/)_

This repository contains the core: the engine, the desktop app and the operator's control view. Plugins live in their own repositories of the [Cuelith](https://github.com/Cuelith) organisation.

> Status: preview. The foundations are complete and tested automatically; camera, scenes and live streaming come with the next phase.

## Download

From the [website](https://cuelith.lzrhive.it/en/#download) or from the [latest release](https://github.com/Cuelith/cuelith-core/releases/latest):

- **Windows**: `Cuelith-Setup-<version>.exe`. No administrator rights needed. The installer is not signed yet, so on first launch Windows may ask for confirmation: **More info → Run anyway**.
- **Linux**: `Cuelith-<version>-x86_64.AppImage`.

The interface is available in English and Italian. Updates download by themselves and install only when you decide, never while you are on air. To remove Cuelith on Windows use **Settings → Apps → Installed apps → Cuelith → Uninstall**; on Linux delete the AppImage file.

## Run it from source

You need [Node.js](https://nodejs.org) 24 and [pnpm](https://pnpm.io) 12. Clone the repositories side by side in one folder:

```bash
git clone https://github.com/Cuelith/cuelith-sdk.git
git clone https://github.com/Cuelith/plugin-locale-it.git
git clone https://github.com/Cuelith/plugin-locale-en.git
git clone https://github.com/Cuelith/cuelith-core.git

cd cuelith-sdk && pnpm install && pnpm build && cd ..
cd cuelith-core && pnpm install && pnpm build && pnpm start
```

The Electron executable is downloaded on first launch.

## Contributing

- [How to propose a change](https://github.com/Cuelith/.github/blob/main/CONTRIBUTING.md) ([italiano](https://github.com/Cuelith/.github/blob/main/CONTRIBUTING.it.md))
- [Developer guide: writing a plugin that stays compatible](https://github.com/Cuelith/.github/blob/main/DEVELOPERS.md) ([italiano](https://github.com/Cuelith/.github/blob/main/DEVELOPERS.it.md))
- [Reporting a security problem](https://github.com/Cuelith/.github/blob/main/SECURITY.md)
- [Name and logo](https://github.com/Cuelith/.github/blob/main/TRADEMARK.md)

## Privacy

Cuelith has no accounts and collects no data. It connects to the internet for two things only: to check for updates of the app, and to read the public list of plugins when you open the marketplace. Neither request carries personal data or anything from your shows. The automatic update check can be turned off in Settings → About and licence. The installation ID shown there is created on your computer and is never sent to anyone. Shows, songs, images and settings stay on your computer.

A plugin can reach the network only if it declares that permission, which is shown before you install it.

## Code signing policy

Windows releases are built by the [release workflow](.github/workflows/release.yml) of this repository from the tagged source code, and nothing else is signed.

- Committers and reviewers: [@MattiaLazzari](https://github.com/MattiaLazzari)
- Approvers: [@MattiaLazzari](https://github.com/MattiaLazzari)

Every change from outside contributors is reviewed and approved by a reviewer before it is merged, and every release is approved manually before it is signed.

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, with the two exceptions described under [Privacy](#privacy): the update check and the public list of plugins.

## Licence

Cuelith is free software under the [GNU General Public License, version 3 or later](LICENSE). Anyone who distributes Cuelith, modified or not, must do so under the same licence and give the recipients the source code.

**Plugins are not affected.** A plugin that works with Cuelith only through its public interface (the plugin protocol, the [SDK](https://github.com/Cuelith/cuelith-sdk), its panels and its data files) is an independent work: its author can license it as they wish, including as a paid, closed-source plugin. This is stated in the [Plugin Exception](PLUGIN-EXCEPTION.md), an additional permission under section 7 of the GPL. The SDK is a separate work under the Apache License 2.0.

**The name Cuelith.** The licence covers the code, not the identity. The name "Cuelith" and its logo are trademarks of the project owner (registration pending) and identify the official software. If you distribute a modified version, you must give it a different name and a different logo, replace the files in `brand/`, and point updates and the plugin marketplace to your own addresses. You may say it is "based on Cuelith", and you may say a plugin is "for Cuelith". Details: [Name and logo](https://github.com/Cuelith/.github/blob/main/TRADEMARK.md).

Versions published up to 0.2.0 were released under the Apache License 2.0 and stay available under it; the GPL applies to every version from 0.2.5 on.
