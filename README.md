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

[Apache 2.0](LICENSE). The name and the logo are not part of the licence: see [Name and logo](https://github.com/Cuelith/.github/blob/main/TRADEMARK.md).
