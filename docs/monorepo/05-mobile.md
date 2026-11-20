# Mobile app (`mobileRose`)

Expo SDK 58 with expo-router (file-based routing), React Native 0.88, and React 19.3. Develop on device
or emulator; ship builds through EAS, not through Turborepo.

## Quick path

```powershell
pnpm --filter @rose/mobileRose start            # agent-friendly Expo Go URL + QR/metadata files
pnpm --filter @rose/mobileRose start:localhost  # Android emulator/USB (Expo runs adb reverse)
pnpm --filter @rose/mobileRose test             # Jest + React Native Testing Library
pnpm --filter @rose/mobileRose web              # runs the app in the browser
```

On Windows you can run Android and web. iOS requires macOS + Xcode; use Expo Go on a physical iPhone
instead.

`android` and `ios` are interactive Expo shortcuts: they open the app but do not write the connection
metadata. Use `start:localhost` when an agent needs the URL/QR files for an emulator or USB device.

## Connect with Expo Go (human or agent)

`start` and `dev` run `scripts/start-expo.mjs`. The wrapper picks a reachable LAN IP, finds a free port
from 8081, prints machine-readable lines, and writes two files under `mobileRose/.expo/`:

```powershell
pnpm --filter @rose/mobileRose start
# [rose-mobile] mode=lan host=192.168.1.7 port=8081
# [rose-mobile] expo-go: exp://192.168.1.7:8081
# [rose-mobile] qr: C:\rose\mobileRose\.expo\expo-go-qr.png
# [rose-mobile] metadata: C:\rose\mobileRose\.expo\rose-dev.json
```

- `.expo/rose-dev.json` holds `mode`, `host`, `port`, `expoGoUrl`, `qrPath`, `metadataPath`, `pid`, and
  `status` (`starting`, `ready`, `stopped`).
- `.expo/expo-go-qr.png` is a 512px QR for the same URL.

Agents usually run the command and never see the terminal. Read `.expo/rose-dev.json` and send its
`expoGoUrl` to the human; never rely on the QR being visible. The human can open the PNG or use Expo Go
→ **Enter URL manually**.

| Situation                             | Command           | Notes                                                         |
| ------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Phone and computer on the same Wi-Fi  | `start`           | Default LAN mode                                              |
| Different network or restricted Wi-Fi | `start:tunnel`    | Slower; may install `@expo/ngrok`                             |
| Android emulator or USB device        | `start:localhost` | Expo runs `adb reverse` for the dev-server port automatically |
| iOS simulator (macOS)                 | `ios`             | Interactive shortcut; opens the simulator (no metadata files) |

- The QR appears only in an interactive Expo terminal. Press `E` to reprint it; `CI=1` disables it.
- Expo Go must match SDK 58: install from <https://expo.dev/go> or run
  `pnpm dlx expo-go download android 58`.
- Firewall: allow Node/Metro on port 8081 for **Private** networks. The wrapper uses 8082+ when 8081 is
  busy, but the firewall rule still needs the port range you actually use.
- The wrapper pins the Wi-Fi IP because virtual adapters (Hyper-V, VMware, WSL) would otherwise be
  advertised and are usually unreachable from the phone. Override with `EXPO_LAN_HOST`.
- When the app calls the API from a phone, use `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8080`, not
  `localhost`.

## Stack

| Piece        | Version | Notes                             |
| ------------ | ------- | --------------------------------- |
| Expo         | 58.0.x  | SDK-matched packages              |
| React Native | 0.88.1  | New Architecture                  |
| React        | 19.3.0  | shared version with web           |
| expo-router  | 58.0.x  | file-based routes under `src/app` |
| TypeScript   | ~6.0.3  | `tsc --noEmit` for type checks    |
| ESLint       | ^9      | `eslint-config-expo` flat config  |
| Jest         | 30.5.x  | `jest-expo` preset                |

## Layout

| Path                  | Responsibility                                        |
| --------------------- | ----------------------------------------------------- |
| `src/app/_layout.tsx` | root navigator / providers                            |
| `src/app/index.tsx`   | `/` screen                                            |
| `src/app/explore.tsx` | `/explore` screen                                     |
| `src/components/`     | shared UI; `.web.tsx` files are web-specific variants |
| `src/hooks/`          | hooks; same platform-suffix convention                |
| `src/constants/`      | theme tokens                                          |
| `src/__tests__/`      | Jest + React Native Testing Library tests             |
| `test/style-mock.js`  | CSS stub for Jest                                     |
| `assets/images/`      | icons, splash                                         |
| `app.json`            | app identity, plugins, experiments                    |

Platform-specific files: `animated-icon.tsx` + `animated-icon.web.tsx` resolve per platform
automatically. Prefer that over `Platform.OS` branches for larger differences.

## Scripts

| Task           | Command                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| Dev (turbo)    | `pnpm --filter @rose/mobileRose dev` (what `pnpm dev` runs; same wrapper) |
| Dev server     | `pnpm --filter @rose/mobileRose start` (LAN URL, QR, metadata)            |
| Localhost      | `pnpm --filter @rose/mobileRose start:localhost` (emulator/USB)           |
| Tunnel         | `pnpm --filter @rose/mobileRose start:tunnel` (different network)         |
| Stock Expo     | `pnpm --filter @rose/mobileRose start:plain` (no wrapper)                 |
| Test           | `pnpm --filter @rose/mobileRose test`                                     |
| Test watch     | `pnpm --filter @rose/mobileRose test:watch`                               |
| Android        | `pnpm --filter @rose/mobileRose android`                                  |
| iOS (macOS)    | `pnpm --filter @rose/mobileRose ios`                                      |
| Web preview    | `pnpm --filter @rose/mobileRose web`                                      |
| Lint           | `pnpm --filter @rose/mobileRose lint` (`expo lint`)                       |
| Type check     | `pnpm --filter @rose/mobileRose check-types`                              |
| Reset template | `pnpm --filter @rose/mobileRose reset-project` (destructive)              |

There is **no `build` script on purpose**. Native binaries are produced by EAS:

```powershell
pnpm --filter @rose/mobileRose exec eas build --platform android   # requires eas-cli + account
```

## Testing

Jest (`jest-expo` preset) plus React Native Testing Library.

- `preset: "jest-expo"` lives in `mobileRose/package.json`.
- `moduleNameMapper` maps `\.css$` to `test/style-mock.js` and `^@/(.*)$` to `<rootDir>/src/$1`.
- `src/__tests__/themed-text.test.tsx` is the starter test.
- `mobileRose/tsconfig.json` sets `types: ["jest", "expo/types"]`, so Jest globals type-check without
  extra imports.

| Task     | Command                                     |
| -------- | ------------------------------------------- |
| Run once | `pnpm --filter @rose/mobileRose test`       |
| Watch    | `pnpm --filter @rose/mobileRose test:watch` |

## Monorepo specifics

- `pnpm-workspace.yaml` sets `nodeLinker: hoisted`. Expo on pnpm expects a hoisted layout; do not
  remove it. (SDK 54+ tolerates isolated installs, but hoisted keeps Metro predictable.)
- Metro watches the monorepo automatically since SDK 52 — no `watchFolders` config needed.
- Native module autolinking resolution is automatic for monorepos in SDK 55+. This project is SDK 58,
  so it is on by default.
- Always add Expo packages with `expo install` so versions stay SDK-compatible.

## Generated files

`expo-env.d.ts` is generated by Expo and gitignored. Do not commit it; regenerate it by running any
Expo command (for example `pnpm --filter @rose/mobileRose start`). Types come from `expo/types`, listed
in `mobileRose/tsconfig.json`; the file is included so the generated declarations resolve.

The wrapper also writes `mobileRose/.expo/rose-dev.json` (connection metadata) and
`mobileRose/.expo/expo-go-qr.png` (QR image). Both are inside the gitignored `.expo/` directory and are
recreated on every start. Do not commit them.

## Add a screen

Create `src/app/settings.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function SettingsScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Settings</Text>
    </View>
  );
}
```

The route is `/settings`. Use `<Link href="/settings">` from `expo-router` to navigate.

## Environment variables

Only `EXPO_PUBLIC_*` variables are inlined into the app. Put them in `mobileRose/.env.local`
(gitignored). Anything secret must stay on the API.

## Checklist

- [ ] `pnpm --filter @rose/mobileRose check-types` passes.
- [ ] `pnpm --filter @rose/mobileRose test` passes.
- [ ] `expo install` used for every Expo/native package.
- [ ] No `node_modules` inside `mobileRose/`.

## Next step

Something broke? [06-troubleshooting.md](./06-troubleshooting.md).
