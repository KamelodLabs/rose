# Mobile app (`mobileRose`)

Expo SDK 58 with expo-router (file-based routing), React Native 0.88, and React 19.3. Develop on device
or emulator; ship builds through EAS, not through Turborepo.

## Quick path

```powershell
pnpm --filter @rose/mobileRose start      # QR code for Expo Go / dev client
pnpm --filter @rose/mobileRose android    # Android emulator or device
pnpm --filter @rose/mobileRose web        # runs the app in the browser
```

On Windows you can run Android and web. iOS requires macOS + Xcode; use Expo Go on a physical iPhone
instead.

## Stack

| Piece        | Version | Notes                             |
| ------------ | ------- | --------------------------------- |
| Expo         | 58.0.x  | SDK-matched packages              |
| React Native | 0.88.1  | New Architecture                  |
| React        | 19.3.0  | shared version with web           |
| expo-router  | 58.0.x  | file-based routes under `src/app` |
| TypeScript   | ~6.0.3  | `tsc --noEmit` for type checks    |
| ESLint       | ^9      | `eslint-config-expo` flat config  |

## Layout

| Path                  | Responsibility                                        |
| --------------------- | ----------------------------------------------------- |
| `src/app/_layout.tsx` | root navigator / providers                            |
| `src/app/index.tsx`   | `/` screen                                            |
| `src/app/explore.tsx` | `/explore` screen                                     |
| `src/components/`     | shared UI; `.web.tsx` files are web-specific variants |
| `src/hooks/`          | hooks; same platform-suffix convention                |
| `src/constants/`      | theme tokens                                          |
| `assets/images/`      | icons, splash                                         |
| `app.json`            | app identity, plugins, experiments                    |

Platform-specific files: `animated-icon.tsx` + `animated-icon.web.tsx` resolve per platform
automatically. Prefer that over `Platform.OS` branches for larger differences.

## Scripts

| Task           | Command                                             |
| -------------- | --------------------------------------------------- |
| Dev server     | `pnpm --filter @rose/mobileRose start`              |
| Android        | `pnpm --filter @rose/mobileRose android`            |
| iOS (macOS)    | `pnpm --filter @rose/mobileRose ios`                |
| Web preview    | `pnpm --filter @rose/mobileRose web`                |
| Lint           | `pnpm --filter @rose/mobileRose lint` (`expo lint`) |
| Type check     | `pnpm --filter @rose/mobileRose check-types`        |
| Reset template | `node ./scripts/reset-project.js` (destructive)     |

There is **no `build` script on purpose**. Native binaries are produced by EAS:

```powershell
pnpm --filter @rose/mobileRose exec eas build --platform android   # requires eas-cli + account
```

## Monorepo specifics

- `pnpm-workspace.yaml` sets `nodeLinker: hoisted`. Expo on pnpm expects a hoisted layout; do not
  remove it. (SDK 54+ tolerates isolated installs, but hoisted keeps Metro predictable.)
- Metro watches the monorepo automatically since SDK 52 — no `watchFolders` config needed.
- Native module autolinking resolution is automatic for monorepos in SDK 55+. This project is SDK 58,
  so it is on by default.
- Always add Expo packages with `expo install` so versions stay SDK-compatible.

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
- [ ] `expo install` used for every Expo/native package.
- [ ] No `node_modules` inside `mobileRose/`.

## Next step

Something broke? [06-troubleshooting.md](./06-troubleshooting.md).
