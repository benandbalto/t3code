# T3 Workspaces

A tmux-inspired fork of [T3 Code](https://github.com/pingdotgg/t3code) for working with several coding agents side by side. Open a project or remote server as a workspace, arrange up to **eight chat sessions in one horizontal row**, and switch between workspace tabs.

**Experimental macOS preview · Apple Silicon · macOS 13 or newer · Manual updates**

[Download the preview](https://github.com/benandbalto/t3code/releases/tag/workspaces-v0.1.6-preview.2) · [Workspace guide](docs/user/thread-sidebar.md#view-threads-in-workspaces) · [Report a problem](https://github.com/benandbalto/t3code/issues)

![Eight sessions in one horizontal row](https://github.com/benandbalto/t3code/releases/download/workspaces-v0.1.6-preview.2/eight-sessions.png)

## Install on a Mac

1. Download `T3-Workspaces-0.1.6-arm64.dmg` from the [preview release](https://github.com/benandbalto/t3code/releases/tag/workspaces-v0.1.6-preview.2).
2. Open the DMG and drag **T3 Workspaces (Beta)** into **Applications**.
3. Open the app. Install and authenticate a [supported agent provider](docs/user/install.md) on each machine where you want agents to run.

This preview has no Apple Developer ID signature or notarization. macOS may block a downloaded copy. If you choose to run it, follow [Apple's instructions for opening an unnotarized app](https://support.apple.com/en-us/102445), including **System Settings → Privacy & Security → Open Anyway** after attempting to open it.

The fork has its own app identity and keeps its data in `~/.t3-workspaces/userdata` and its app profile in `~/Library/Application Support/t3workspaces`. Existing T3 Code data and saved connections are not imported. You can keep both apps installed.

## Start a workspace

For remote work, go to **Settings → Environments → Add environment → SSH** and enter a host or SSH alias. The app opens the SSH tunnel and starts or reuses the T3 server there. Alternatively, add a pairing URL from an existing server. This preview is based on T3 Code **0.1.6** and uses that published server version for SSH setup.

Open a session on a machine, then use **Open session workspace** beside the sidebar search to choose its server or project. Each session has its own navigation, scrolling, and composer. Active sessions fill the row; **Include settled** includes parked sessions, and **Refresh sessions** updates the snapshot without constantly rearranging your slots. More than eight sessions are available on additional pages.

| Shortcut                  | Action                                      |
| ------------------------- | ------------------------------------------- |
| `Ctrl+Alt+S`              | Open the current server workspace           |
| `Ctrl+Alt+P`              | Open the current project workspace          |
| `Ctrl+Alt+1`–`8`          | Switch workspace tabs                       |
| `Ctrl+Alt+Left` / `Right` | Focus the previous / next session           |
| `Ctrl+Alt+Enter`          | Open a manual workspace or add a slot       |
| `Ctrl+Alt+Z`              | Zoom the selected session / restore the row |

Workspace tabs, slot assignments, selection, and pages restore after a restart. Open workspace tabs keep their current page loaded and connected in the background, so switching back preserves scrolling and unsent drafts without reloading. Keeping more tabs open uses more memory. Close a workspace or exit tiles to unload its views; its agents keep running.

## Preview support and limitations

- The downloadable app targets **Apple Silicon macOS**. Intel Macs, Windows, Linux, and the upstream mobile clients are not supported by this preview release.
- Updates are manual: quit T3 Workspaces, download a newer preview, and replace the app in Applications. Keep your data folders to retain sessions and layouts. This build has no automatic update feed.
- Each visible session runs a full client view. Eight columns work best on a wide display and can use substantially more memory than one session.
- This is an early preview. See the release notes for the workload actually tested; a short synthetic check is not a full working-day soak or validation of every provider and desktop feature.
- Share reproducible problems with your macOS version, chip, pane count, provider, connection mode, and steps. Remove pairing codes, credentials, and private transcripts from reports.

## Build from source

### Install `vp`

Install [Vite+](https://viteplus.dev/guide/), which manages the Node and package-manager versions pinned by the repository:

```sh
curl -fsSL https://vite.plus | bash
```

Then clone this fork and install dependencies:

```sh
git clone https://github.com/benandbalto/t3code.git
cd t3code
vp i
vp run dev --home-dir .t3
```

Open the pairing URL printed by the development server. To build the Mac installer, install the Xcode Command Line Tools and [Rust](https://rustup.rs/), then run:

```sh
vp run dist:desktop:dmg --arch arm64 --build-version 0.1.6
```

The installer is written to `release/`. Keep the app version at the published upstream server version unless you also change how SSH server downloads are resolved. See [development and packaging](docs/operations/development.md#t3-workspaces-fork-on-macos) for data directories and update behavior.

## Upstream and license

T3 Workspaces is an independent, experimental fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code), built by T3 Tools and its contributors. The original project supplies the agent integrations, server, desktop shell, and remote access support. This fork adds the tiled session workspace and its persistence and uses a separate desktop identity. It is not an official T3 Tools release.

[MIT license](LICENSE). Upstream documentation remains in [docs/](docs/); installation links and release procedures there may describe the upstream product.
