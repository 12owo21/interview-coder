# AGENTS.md

## Project Overview

**Interview Coder CN** (截屏解题助手) is a desktop application that captures screenshots of on-screen problems (coding challenges, exam questions, or anything else) and uses AI (vision models) to generate solutions in real-time. The window is invisible to screen-sharing software, making it suitable for use during coding interviews and online assessments.

Key capabilities:
- Global shortcuts trigger screenshot capture → AI analysis → streamed solution display
- Frameless, transparent, always-on-top overlay window invisible to screen-sharing
- Mouse passthrough mode (window ignores mouse events)
- Multi-screenshot conversation continuity (append screenshots to existing context)
- Follow-up questions within the same conversation
- Real-time speech transcription (DashScope Fun-ASR) — transcribed text is attached to screenshots when sent to AI
- Configurable AI provider (OpenAI, SiliconFlow, OpenRouter, or any OpenAI-compatible API)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 37 (electron-vite 4) |
| Frontend | React 19, TypeScript 5.8 |
| Styling | Tailwind CSS v4, shadcn/ui (New York style), Radix primitives |
| State | Zustand 5 (5 stores, 2 with localStorage persistence) |
| Routing | react-router v7 (HashRouter, 3 routes) |
| AI | Vercel AI SDK (`ai` + `@ai-sdk/openai`), streaming via `streamText()` |
| Build | electron-vite (Vite 7), electron-builder 25 |
| Linting | ESLint 9 (flat config), Prettier |

## Directory Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry: lifecycle, error handling, app.whenReady()
│   ├── main-window.ts       # BrowserWindow creation (frameless, transparent, always-on-top)
│   ├── toolbar-window.ts    # Overlay toolbar window: bounds/visibility/opacity glued to main window
│   ├── shortcuts.ts         # Global shortcuts registration + AI streaming orchestration (largest file)
│   ├── ai.ts                # Vercel AI SDK integration, 3 streaming functions
│   ├── thinking.ts          # 「关闭思考」: per-platform request-body fields + retry without them when refused
│   ├── model-list.ts        # `listModels` IPC: a platform's `/models` list (+ SiliconFlow vision flags scraped from its public model square)
│   ├── settings.ts          # App settings object + IPC handlers
│   ├── state.ts             # App state object + IPC handlers
│   ├── take-screenshot.ts   # desktopCapturer → base64 PNG of the screen under the cursor or a fixed one, cropped to `captureRegion`; `getDisplays` IPC
│   ├── region-picker.ts     # One full-screen window per screen to drag out the capture region
│   ├── save-screenshot.ts   # Optional auto-save of each screenshot to a folder
│   ├── save-code.ts         # First code block of a finished answer → clipboard and/or source file
│   ├── transcription.ts     # DashScope WebSocket real-time speech-to-text
│   ├── window-resize.ts     # Cursor-tracking resize for the frameless windows
│   ├── auto-updater.ts      # electron-updater (non-macOS only)
│   └── index.d.ts           # global.mainWindow type declaration
├── preload/
│   ├── index.ts             # contextBridge API: exposes window.api to renderer
│   └── index.d.ts           # Type declarations for window.electron and window.api
├── shared/                  # Pure TS used by both main and renderer (no Electron / DOM / Node imports)
│   ├── request-headers.ts   # Parse the custom request headers text, merge it over the Bearer key
│   └── capture-region.ts    # CaptureRegion type + fractions → pixels, for main's crop and the picker's readout
└── renderer/
    ├── index.html            # SPA entry
    └── src/
        ├── main.tsx          # React root render
        ├── App.tsx           # Router + settings sync + shortcut init + Toaster
        ├── coder/            # Main page: screenshot display + AI solution stream
        │   ├── index.tsx     # CoderPage layout + state sync + transcription lifecycle
        │   ├── AppHeader.tsx # Draggable title bar with nav buttons
        │   ├── AppContent.tsx# Screenshots gallery + markdown solution + error banner
        │   ├── AppStatusBar.tsx    # Loading indicator, follow-up dialog, shortcut hints
        │   ├── TranscriptionBar.tsx # Absolute-positioned real-time transcription overlay
        │   ├── OverlayToolbar.tsx  # Contents of the toolbar window (route `/toolbar`)
        │   └── PrerequisitesChecker.tsx  # Modal for API key setup
        ├── settings/         # Settings page
        │   ├── index.tsx     # AI config, coding, appearance, shortcuts, privacy
        │   ├── ApiProfiles.tsx     # Saved AI profiles: switch, add, rename, remove
        │   ├── ModelField.tsx      # Model row: picker + mismatch warning with one-click fix
        │   ├── ApiHeadersField.tsx # Custom request headers textarea + ignored-line warning
        │   ├── CaptureTargetFields.tsx # Which screen to capture (cursor / fixed) + the optional capture region
        │   ├── SelectModel.tsx     # Model combobox that follows the API Base URL
        │   ├── SelectBaseURL.tsx   # API Base URL combobox (presets from lib/providers.ts)
        │   └── CustomShortcuts.tsx # Shortcut key recorder
        ├── region-picker/    # One screen of the capture-region picker (`#/region-picker`, rendered without App)
        ├── help/             # Help page
        │   ├── index.tsx     # Quick start guide, shortcuts, toolbar, FAQ
        │   ├── Shortcuts.tsx
        │   ├── OverlayToolbar.tsx  # Toolbar section (buttons + meanings + shortcuts)
        │   ├── FAQ.tsx
        │   └── components/index.tsx  # HelpSection wrapper
        ├── components/
        │   ├── MarkdownRenderer.tsx   # react-markdown + remark-gfm + rehype-highlight
        │   ├── ShortcutRenderer.tsx   # Platform-aware shortcut key badges
        │   ├── WindowResizeHandles.tsx # Edge/corner drag targets that drive window-resize.ts
        │   └── ui/           # shadcn/ui primitives (button, dialog, select, etc.)
        ├── lib/
        │   ├── store/        # Zustand stores
        │   │   ├── app.ts       # ignoreMouse state, synced from main process
        │   │   ├── settings.ts  # API config, model, prompt scenes, opacity, toolbar (persisted v8)
        │   │   ├── shortcuts.ts # Shortcut bindings (persisted v5, with migration)
        │   │   ├── solution.ts  # Loading state, solution chunks, screenshots, errors
        │   │   └── transcription.ts # Transcription state: isTranscribing, text, error
        │   ├── toolbar-actions.ts # Toolbar button list (action + icon + label), shared with help
        │   ├── providers.ts  # Known platforms + each one's spelling of the same model
        │   ├── platform-models.ts # usePlatformModels(): cached `/models` list per URL + key
        │   ├── model-switch.ts    # changeApiBaseURL(): switch URL, toast the linked model change
        │   ├── api-profiles.ts    # ApiProfile type + factory (one saved URL / key / model set)
        │   ├── use-elapsed.ts     # Header timer: local tick while loading, main's measured value after
        │   ├── utils/
        │   │   ├── index.ts     # cn() helper, getCloneableFields()
        │   │   ├── env.ts       # isMac, platformAlt
        │   │   ├── duration.ts  # formatDuration(): 3s / 1m05s
        │   │   └── keyboard.ts  # Accelerator string conversion
        │   └── audio-capture.ts # System audio capture via getDisplayMedia for transcription
        └── assets/
            ├── base.css      # Tailwind @import, CSS variables, app layout styles
            └── main.css      # Tailwind + typography plugin + theme variables (oklch)
```

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────┐
│  Main Process (src/main/)                           │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ settings │  │  state   │  │    shortcuts.ts    │ │
│  │   .ts    │  │   .ts    │  │  (orchestrator)   │ │
│  └────┬─────┘  └────┬─────┘  │  - global hotkeys │ │
│       │              │        │  - AI streaming   │ │
│       │              │        │  - conversation   │ │
│       │              │        │    management     │ │
│       │              │        └──┬───────────┬────┘ │
│       │              │           │           │      │
│       │              │     ┌─────┴──┐  ┌─────┴────┐ │
│       │              │     │ ai.ts  │  │take-     │ │
│       │              │     │        │  │screenshot│ │
│       │              │     └────────┘  └──────────┘ │
│       └──────────────┼───────────┘                  │
│              IPC (ipcMain.handle)                    │
├─────────────────────────────────────────────────────┤
│  Preload (src/preload/)                             │
│  contextBridge → window.api                         │
├─────────────────────────────────────────────────────┤
│  Renderer (src/renderer/)                           │
│  React app with Zustand stores                      │
│  window.api.on*() for events from main              │
│  window.api.*() for invoke calls to main            │
└─────────────────────────────────────────────────────┘
```

### Data Flow: Screenshot → Solution

1. User presses global shortcut (e.g., `Alt+Enter` on macOS)
2. `shortcuts.ts` callback triggers `takeScreenshot()` → `desktopCapturer` → base64 PNG. It captures the screen under the cursor, or the one fixed in `captureScreen` (a `Display.id`; a disconnected one falls back to the cursor), matching the source by `display_id` — `desktopCapturer` returns screens in no particular order. A `captureRegion` overrides the screen choice and crops the capture (see Capture Region)
3. Main sends `screenshot-taken` and `ai-loading-start` to renderer
4. Main calls `getSolutionStream(base64Image)` → Vercel AI SDK `streamText()`
5. Stream chunks sent to renderer via `solution-chunk` IPC events
6. Renderer accumulates chunks in `useSolutionStore` and renders via `MarkdownRenderer`
7. On completion: `solution-complete`; on error: `solution-error`; on abort: `solution-stopped`

### IPC Channels

**Renderer → Main (invoke):**
- `getAppSettings` / `updateAppSettings` — settings CRUD
- `listModels` — fetch the model list of an OpenAI-compatible platform (runs in main to avoid CORS)
- `getDisplays` — connected screens (numbered left to right) for the capture-screen picker
- `pickCaptureRegion` — cover every screen with a region picker; resolves with the region, or null if cancelled
- `getRegionPickerData` / `region-picker-ready` / `finish-region-picker` (the last two `send`) — a picker window fetches its frozen screen, asks to be shown once painted, and reports the result
- `updateAppState` — sync `inCoderPage`, `inSettingsPage`
- `setIgnoreMouse` — set click-through from the settings page switch
- `initShortcuts` / `getShortcuts` / `updateShortcuts` — shortcut management
- `stopSolutionStream` — abort current AI stream
- `sendFollowUpQuestion` — follow-up within conversation
- `triggerAction` / `setToolbarVisible` — overlay toolbar: run a shortcut action, toggle the window
- `selectScreenshotDir` / `selectCodeDir` — folder pickers for the auto-save settings
- `window-resize-start` / `window-resize-stop` (`send`, not `invoke`) — begin/end a cursor-tracked window resize
- `start-transcription` / `stop-transcription` — speech transcription lifecycle
- `get-transcription-text` / `clear-transcription-text` — read/clear accumulated text

**Main → Renderer (send):**
- `sync-app-state` — push state changes (e.g., mouse ignore toggle) to both the main and the toolbar window
- `screenshot-taken` / `screenshots-updated` — screenshot data (`screenshots-updated` also carries the untruncated conversation total)
- `solution-clear` / `solution-chunk` / `solution-complete` / `solution-stopped` / `solution-error` — AI streaming lifecycle
- `ai-loading-start` / `ai-loading-end` — loading state
- `solution-duration` — how long the finished request took (ms), timed in main from the key press
- `switch-api-profile` — step the active AI profile (`1` / `-1`); the list lives in the renderer store
- `thinking-unsupported` — the active model refused 「关闭思考」 (model name); sent once per model per session, the request has already been resent without it
- `capture-region-picked` — a new capture region, from whichever entry point started the pick
- `scroll-page-up` / `scroll-page-down` — keyboard-driven scroll
- `toggle-transcription` — trigger start/stop transcription from shortcut
- `sync-toolbar-settings` — push toolbar-only settings (hover dwell) into the toolbar window
- `transcription-text` / `transcription-error` / `transcription-stopped` / `transcription-cleared` — transcription events

### Zustand Stores

| Store | File | Persisted | Key State |
|-------|------|-----------|-----------|
| `useSettingsStore` | `lib/store/settings.ts` | Yes (v8) | `apiProfiles`, `activeProfileId`, `hasConfiguredApi`, `apiBaseURL`, `apiKey`, `apiHeaders`, `model`, `disableThinking` (mirror of the active profile), `customModels`, `customModelsByBaseURL`, `modelByBaseURL`, `scenes` (prompt scenes), `activeSceneId`, `customPrompt` (derived from active scene), `opacity`, `resizable`, `showOverlayToolbar`, `toolbarHoverDelay`, `hideShortcutHints`, `screenshotDisplay`, `captureScreen`, `captureRegion`, `screenshotAutoSave`, `screenshotDir`, `codeAutoSave`, `codeSaveDir`, `codeFileBaseName`, `codeNamingMode`, `codeCopyToClipboard`, `dashscopeApiKey` |
| `useShortcutsStore` | `lib/store/shortcuts.ts` | Yes (v5) | `shortcuts` (action → key mapping with categories); `merge` adds new default actions on every load, so a new shortcut needs no `version` bump |
| `useSolutionStore` | `lib/store/solution.ts` | No | `isLoading`, `solutionChunks`, `screenshotData`, `errorMessage`, `durationMs` |
| `useTranscriptionStore` | `lib/store/transcription.ts` | No | `isTranscribing`, `transcriptionText`, `errorMessage` |
| `useAppStore` | `lib/store/app.ts` | No | `ignoreMouse` |

Settings are bidirectionally synced: renderer persists to localStorage, and on mount syncs to main process via `updateAppSettings()`. Main process `.env` values serve as initial defaults only.

Adding a settings key needs no `version` bump: zustand shallow-merges the persisted object over the defaults, so a key missing from localStorage falls back to its default. Bump `version` only when an existing key changes shape or meaning.

## Key Patterns & Conventions

### Window Stealth

The app is designed to be invisible to screen-sharing software:
- `BrowserWindow` options: `transparent: true`, `frame: false`, `skipTaskbar: true`
- `setContentProtection(true)` prevents screen capture of the window itself
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`
- `keepWindowInFront()` repeatedly reasserts always-on-top for 5 seconds after show
- `showInactive()` on macOS/Windows to avoid stealing focus

### Overlay Toolbar

A second `BrowserWindow` (`src/main/toolbar-window.ts`) that renders the `/toolbar` route, so the shortcut actions can be driven with the mouse instead of the keyboard:
- Owns its own visibility state: the renderer calls `setToolbarVisible()` (main page + `showOverlayToolbar` setting), main additionally requires the main window to be visible. Never call `showInactive()` on it directly — go through `showToolbar()` / `hideToolbar()`.
- `focusable: false` so clicking a button never pulls focus away from the app underneath
- Opacity is applied at the window level to match the main window, which applies its own via `document.body.style.opacity`
- It is a separate renderer process, so its Zustand store is a **separate copy** that does not see changes made in the main window. Settings it needs must be pushed from main (`sync-toolbar-settings`), not read from the store.
- Buttons carry no `title`: native tooltips are drawn outside the window and are not covered by content protection
- It never receives a `click` on Windows: `focusable: false` makes Chromium answer the press's WM_MOUSEACTIVATE with `MA_NOACTIVATEANDEAT`, so the button-down is dropped by the OS. Only the release and the moves arrive — anything interactive in this window must hang off `mouseup`/`pointermove`, never `click` or `pointerdown`
- `TOOLBAR_ACTIONS` (`lib/toolbar-actions.ts`) drives both the toolbar and its help page section; `triggerAction` is validated against `clickableActions` in `shortcuts.ts`
- Resizing the toolbar window never rescales its buttons: `OverlayToolbar` measures the bar and renders only the actions that fit, dropping the rest from the end

### Window Resizing

Both windows are created with `resizable: false` — toggling Electron's native resizable style breaks transparency on Windows — so resizing is implemented by hand:
- `WindowResizeHandles` renders eight fixed-position edge/corner divs — or, with `axis="x"`, just the two side edges — and sends only `window-resize-start` (pointerdown) and `window-resize-stop`
- `nonActivating` (the toolbar) also starts the drag from the first pointermove made with the button held, because Windows never delivers that window's pointerdown (see Overlay Toolbar)
- `src/main/window-resize.ts` then polls `screen.getCursorScreenPoint()` and calls `setBounds()`. The cursor is sampled in main because the toolbar is a non-activating panel on macOS and never receives a drag's pointer moves
- The drag is ended by a `window`-level `pointerup`/`pointercancel`/`blur` listener, with a 30s safety timeout in main as the last resort
- The handles sit at `z-index: 2147483647`; anything flush against a window edge (e.g. `#app-header .actions`) must raise itself above them or it becomes unclickable
- The main window's handles are gated by the `resizable` setting; the toolbar's are always on but width-only (`axis="x"` — its height is the button row), with the resize cursor suppressed in `main.css`

### AI Integration

- All AI calls go through `src/main/ai.ts` using Vercel AI SDK's `streamText()`
- Provider: `@ai-sdk/openai` with custom `baseURL` (works with any OpenAI-compatible API)
- Custom request headers (`apiHeaders`, one `Name: Value` per line) go on every AI request and on the `/models` fetch, through `buildRequestHeaders()` in `src/shared/request-headers.ts`. They override the Bearer key case-insensitively, so a gateway can replace `Authorization`
- Model fallback: `Qwen/Qwen3-VL-32B-Instruct` for SiliconFlow, `gpt-5-mini` otherwise
- AI profiles (`apiProfiles`): each holds its own URL / key / headers / model / thinking switch, and the active one is mirrored onto the flat `apiBaseURL` / `apiKey` / `apiHeaders` / `model` / `disableThinking` fields that main reads (`CREDENTIAL_KEYS`). The profile is authoritative (`reconcileApiProfiles()` restores the flat fields from it on load), so never write those with `updateSetting`: use `updateCredential()`, `changeApiBaseURL()` or `setModel()`, which keep the profile in step — otherwise the edit is lost on the next profile switch or restart
- The welcome dialog (`PrerequisitesChecker`) shows only until a key has ever been saved (`hasConfiguredApi`), so a request made with a blank profile key is reported by main as a `solution-error` instead
- Model ↔ API Base URL linkage lives in the renderer (`lib/providers.ts`): each platform spells the same model differently (`deepseek-flash` vs `deepseek/deepseek-v4.1-flash`), so the picker lists the selected platform's spelling and `setApiBaseURL()` translates the model on switch (else restores the one last used with that URL, else the platform default). Change the API Base URL through `changeApiBaseURL()`, not `updateSetting`, so the model follows and the user gets an undo toast. Preset models must accept image input
- System prompts are maintained in the renderer settings store (`PRESET_SCENE_PROMPTS` in `lib/store/settings.ts`) as "prompt scenes"; the active scene's prompt is synced to the main process as `customPrompt`
- Three streaming functions: `getSolutionStream` (first screenshot), `getFollowUpStream` (follow-up), `getGeneralStream` (multi-screenshot)
- 「关闭思考」 (`disableThinking`, per profile, off by default): the SDK has no field for it and every platform spells it differently, so `createThinkingOffFetch()` in `thinking.ts` wraps `fetch` and merges the fields into the request body — OpenRouter `reasoning: { enabled: false }`, OpenAI host or a `gpt-`/`o<n>` model name `reasoning_effort: 'none'`, everyone else both `thinking: { type: 'disabled' }` and `enable_thinking: false`. OpenAI rejects any unknown field, and thinking-only models reject the switch, so a 400/422 whose body mentions thinking/reasoning is resent without the fields and that base URL + model is remembered for the session. The switch never makes a request fail; at worst it costs one extra round trip
- Conversation history (`conversationMessages`) is maintained in `shortcuts.ts` as `ModelMessage[]`
- When an answer finishes naturally (not stopped, not failed), `handleGeneratedCode()` in `save-code.ts` copies its first code block to the clipboard and/or saves it as `<base><n>.<ext>` (extension from the fence language); both are opt-in and silent

### Capture Region

`captureRegion` crops every screenshot to one area of one screen, stored as fractions of that screen (`src/shared/capture-region.ts`) so a resolution or scaling change does not shift it:
- Three entry points — the settings button, the toolbar button and the `pickCaptureRegion` shortcut — all go through `pickRegion()` in `shortcuts.ts`, which applies the result to main's `settings` at once and sends `capture-region-picked` for the renderer store to persist
- `pickRegion()` soft-hides the main window (unless it already was), then `region-picker.ts` opens one window per screen at `screen-saver` level above the main window and toolbar, each showing a frozen capture of its screen (content protection keeps the app out of it)
- Started from a shortcut or the toolbar, another app is active: the picker under the cursor takes focus (`app.focus({ steal: true })` on macOS) so Enter / Esc cannot land in, say, an exam page, and `acceptFirstMouse` lets the first click start a drag
- The picker route is rendered straight from `main.tsx`, skipping `App`: a throwaway window must not sync settings or re-register shortcuts
- The pickers cover every screen, so any exit — Enter / Esc, closing one, a crashed or unresponsive renderer, a 5-minute timeout — closes them all and restores the main window
- The dimming around the selection is four plain panels: a `clip-path` hole or a huge `box-shadow` did not paint over the full-screen image
- A region whose screen is disconnected is kept but ignored until it comes back, so the whole screen is captured meanwhile

### Stream Abort Pattern

- `StreamContext` with `AbortController` and `reason` (`'user'` | `'new-request'`)
- New requests automatically abort previous streams
- User can manually stop via shortcut or UI button
- Abort reason determines which IPC event to send (`solution-stopped` for user, silent for new-request)

### Real-time Speech Transcription

- Uses DashScope (Alibaba Cloud) Fun-ASR real-time ASR via WebSocket (`src/main/transcription.ts`)
- Requires a separate `dashscopeApiKey` configured in settings
- Audio is captured in the renderer via `getDisplayMedia()` (system audio), downsampled to 16kHz PCM, and streamed to main process via IPC
- `TranscriptionBar` is absolute-positioned at the top of the coder page, shows up to 3 lines with auto-scroll
- On screenshot (`takeScreenshot` / `appendScreenshot`), accumulated transcription text is automatically attached to the AI prompt, then cleared
- `clearTranscription` shortcut clears text without submitting to AI
- Transcription shortcuts are disabled in settings UI when `dashscopeApiKey` is not configured

### Shortcut System

- Global shortcuts registered via Electron's `globalShortcut` API
- Renderer stores shortcut config in Zustand (persisted); sends to main on init
- On Windows, `Alt`-based shortcuts also register `Ctrl+Alt` variant for compatibility
- Shortcut actions are string-keyed callbacks in `shortcuts.ts`
- Default shortcuts use `platformAlt` (`Alt` on macOS, `CommandOrControl` on Windows)
- New actions also need a label in `settings/CustomShortcuts.tsx` and a description in `help/Shortcuts.tsx`

### Mouse Click-through

- `state.ignoreMouse` is the user's preference; `applyIgnoreMouse()` in `shortcuts.ts` is the only place that applies it to the window. Go through `setIgnoreMouse()` / `applyIgnoreMouse()`, never `setIgnoreMouseEvents()` directly
- It is suspended while the settings page is up (`inSettingsPage`): the switch that turns it off lives there, so applying it would trap the user. The preference is kept and applied on the way out
- Independent of the overlay toolbar, and the shortcut works on every page as an escape hatch

### UI Component Patterns

- shadcn/ui components in `src/renderer/src/components/ui/` — do NOT edit these directly, use the shadcn CLI to add/update
- `cn()` utility (clsx + tailwind-merge) for conditional class merging
- `getCloneableFields()` strips functions from store state before sending over IPC
- Platform-aware shortcut display via `ShortcutRenderer` (⌘, ⌥, ⇧ on Mac; Ctrl, Alt, Shift on Windows)

## Development

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Start in dev mode (electron-vite dev)
npm run build        # Typecheck + build (electron-vite build)
npm run build:mac    # Build macOS distributable
npm run build:win    # Build Windows distributable
npm run typecheck    # Run TypeScript type checking (node + web)
npm run lint         # Run ESLint
npm run format       # Run Prettier
```

### Configuration

The `.env` file at project root configures the AI provider:

```env
API_BASE_URL="https://openrouter.ai/api/v1"  # OpenAI-compatible API endpoint
API_KEY="sk-..."                               # API key
MODEL="gpt-5-mini"                             # Optional: override default model
```

These are read by dotenv in the main process and merged with renderer-side settings (renderer settings take priority when set).

### Path Aliases

- `@renderer/*` and `@/*` both resolve to `src/renderer/src/*`
- Configured in `tsconfig.web.json` and `electron.vite.config.ts`

### Code Style

- Prettier: single quotes, no semicolons, 100 char print width, no trailing commas
- ESLint: TypeScript + React + React Hooks + React Refresh rules
- UI text and user-facing strings are in **Chinese** (中文)
- Code comments and variable names are in **English**

## Important Notes for AI Agents

1. **Three TypeScript configs**: `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer). The root `tsconfig.json` is a project references file only.

2. **System prompts live in the renderer**: All preset scene prompts are defined in `src/renderer/src/lib/store/settings.ts` (`PRESET_SCENE_PROMPTS`). The main process only consumes the synced `customPrompt` and has no built-in prompt of its own.

3. **`global.mainWindow`**: The main window reference is stored as a global variable, declared in `src/main/index.d.ts`.

4. **Settings flow**: `.env` → main process `settings` object → renderer reads on mount via IPC → renderer persists to localStorage via Zustand. Renderer-side changes are sent back to main via `updateAppSettings`.

5. **No shared types directory**: Main process types (`AppSettings`, `AppState`) are imported directly by the preload script from `../main/settings` and `../main/state`. This works because preload shares the Node.js tsconfig. Runtime code both sides need goes in `src/shared/` (included by both tsconfigs, imported by relative path) and must stay free of Electron, DOM and Node APIs.

6. **Streaming orchestration is in `shortcuts.ts`**: Despite the filename, this 580+ line file is the central orchestrator for both global shortcuts AND AI streaming logic. It manages conversation history, abort controllers, and IPC communication for the entire AI workflow.

7. **Window movement**: The window can be moved via keyboard shortcuts in 200px steps (up/down/left/right), and resized by dragging its edges (see Window Resizing).

8. **macOS auto-update is disabled**: `publish: null` in electron-builder.yml for mac target. Auto-update only works on Windows.

9. **macOS and Windows only**: Linux is not a supported or built target.

10. **Prompt files are Prettier-ignored**: `src/renderer/src/lib/store/prompts/` is listed in `.prettierignore` — Prettier rewrites the literal ``` fences inside those prompts, which changes what the model is told.
