# Submitting OpenMHub to Flathub

> **Important:** the manifest in this folder was written with an AI assistant and is kept only as a technical reference. Flathub does not accept AI-generated or AI-assisted manifests, so the manifest submitted to flathub/flathub must be written by hand by the maintainer, and the AI-assisted code in the app must be disclosed in the submission PR.


Files in this folder:

| File | Purpose |
|---|---|
| `io.github.brayanspagnol.OpenMHub.yml` | Flatpak manifest. This is the file submitted to Flathub. |
| `io.github.brayanspagnol.OpenMHub.metainfo.xml` | AppStream metadata, installed from the tagged source |
| `io.github.brayanspagnol.OpenMHub.desktop` | Desktop entry, installed from the tagged source |
| `update-commit.sh` | Pins the manifest's git source to the commit of its tag |

The icons are installed from `app/assets/` and the license from `LICENSE`, so the
metainfo, desktop file, icons and screenshots must all be committed before the
release tag is created.

## Before submitting

Read these first. Each one can block the submission.

- **Generative AI policy.** Flathub's requirements say submitters must disclose
  any AI-generated code, documentation or packaging, and that "Flathub manifests
  must not contain AI-generated or AI-assisted content". This manifest was
  drafted with an AI assistant. Before submitting, write the manifest yourself
  (use this one only as a reference for the values), and disclose any
  AI-generated parts of the app in the PR description.
  See <https://docs.flathub.org/docs/for-app-authors/requirements>.
- **English interface.** The requirements ask for a complete English
  localization of the UI. The interface is Brazilian Portuguese only for now.
  Add English (and make it the default for non-pt locales) before submitting,
  or expect the reviewers to ask for it.
- **Prebuilt Electron.** Flathub asks for builds from source, but Electron apps
  on Flathub routinely ship the official Electron release binary with the
  Electron BaseApp. The app itself has no npm dependencies and no build step,
  so the only prebuilt part is Electron. Say so in the PR.
- **Third-party assets.** Reviewers check redistribution rights:
  - The MiSans fonts in `app/renderer/assets/fonts/` are under Xiaomi's MiSans
    license. Confirm it allows redistribution inside an app, or replace them
    with a freely licensed font.
  - Product pictures are downloaded at runtime from MCHOSE's CDN, which is why
    the manifest has `--share=network`.
- **Trademarks.** The name, icon and screenshots must not suggest an official
  MCHOSE product. The metainfo says the app is unofficial and not affiliated.
- **`--device=all`.** Needed for `/dev/hidraw*` (WebHID). Explain it in the PR;
  there is no narrower Flatpak permission for hidraw.
- **udev rule.** The sandbox cannot install it. Users must install
  `udev/70-mhub-linux.rules` on the host once. Check the app shows a clear
  message when it finds MCHOSE devices it cannot open.

## Release steps

1. Commit everything (app rename, `packaging/flatpak/`, `docs/screenshots/`).
2. Tag and push:
   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push --follow-tags
   ```
3. Pin the commit in the manifest:
   ```sh
   packaging/flatpak/update-commit.sh
   ```
   This replaces the `# commit:` placeholder with the tag's commit. Commit that
   change on `main`; the manifest in the repository is only a copy, the one that
   counts is the one in the Flathub PR.
4. Check that the screenshot URLs in the metainfo now resolve:
   ```sh
   appstreamcli validate --pedantic packaging/flatpak/io.github.brayanspagnol.OpenMHub.metainfo.xml
   ```
   The only remaining pedantic hint should be `cid-contains-uppercase-letter`,
   which Flathub accepts.
5. Build and lint locally (needs `flatpak` and the Flathub remote):
   ```sh
   flatpak install -y flathub org.flatpak.Builder
   flatpak run --command=flathub-build org.flatpak.Builder --install packaging/flatpak/io.github.brayanspagnol.OpenMHub.yml
   flatpak run io.github.brayanspagnol.OpenMHub
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest packaging/flatpak/io.github.brayanspagnol.OpenMHub.yml
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
   ```
   Test on real hardware: device detection, hot-plug (unplug and replug the
   receiver), tray, notifications, and start with the system.

## Opening the pull request

1. Fork <https://github.com/flathub/flathub> with **"Copy the master branch
   only" unchecked**.
2. Clone the `new-pr` branch and branch from it:
   ```sh
   git clone --branch=new-pr git@github.com:brayanspagnol/flathub.git
   cd flathub
   git checkout -b openmhub new-pr
   ```
3. Copy the manifest (with the pinned commit) to the top level:
   ```sh
   cp /path/to/MHUB/packaging/flatpak/io.github.brayanspagnol.OpenMHub.yml .
   git add io.github.brayanspagnol.OpenMHub.yml
   git commit -m "Add io.github.brayanspagnol.OpenMHub"
   git push -u origin openmhub
   ```
   Only the manifest goes in. The metainfo, desktop file and icons come from
   the tagged source. If you drop aarch64, also add a `flathub.json` with
   `{"only-arches": ["x86_64"]}`.
4. Open a pull request against the **`new-pr`** base branch (not `master`),
   titled `Add io.github.brayanspagnol.OpenMHub`.
5. Fill in the PR template checklist. Points worth stating in the description:
   - unofficial app, not affiliated with MCHOSE;
   - why `--device=all`, `--share=network` and the StatusNotifierWatcher
     talk-name are needed;
   - the one-time udev rule on the host;
   - the prebuilt Electron binary, and no other prebuilt code;
   - the AI disclosure required by the policy.
6. Answer the reviewers' questions. Comment `bot, build` on the PR to start a
   test build.
7. After approval you get an invitation to the new
   `flathub/io.github.brayanspagnol.OpenMHub` repository. Enable 2FA on GitHub
   and accept it within one week.

## Verification of the io.github ID

- `io.github.brayanspagnol.OpenMHub` maps to
  `https://github.com/brayanspagnol/OpenMHub`. Flathub requires the ID's
  repository to be reachable and under your control. The code lives in
  `brayanspagnol/OpenMHub`, so either:
  - rename the GitHub repository to `OpenMHub` (GitHub redirects the old URL),
    then update the URLs in the manifest and metainfo; or
  - ask the reviewers whether the ID can stay while the repository is `MHUB`.
- After the app is published, log in to <https://flathub.org> with the
  `brayanspagnol` GitHub account, open the developer portal and verify the
  app. For `io.github.*` IDs this is done by logging in with the matching
  GitHub account; no file on a website is needed.

## Updates after publication

The Flathub repository runs flatpak-external-data-checker with the
`x-checker-data` in the manifest:

- the app source follows new `vX.Y.Z` tags on GitHub;
- the Electron zips follow the latest non-prerelease 42.x release. Move to a
  new Electron major by editing the `test("^v42\\.")` filter.

Each update needs a new `<release>` entry in the metainfo in the tagged source.
