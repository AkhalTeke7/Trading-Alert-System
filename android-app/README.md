# PriceAlert Sound — Android app (`alertapp.akhalteke.com`)

Native Kotlin app that **plays a loud alarm sound** when your Price-Alert website triggers.

Push mode is ON: the app registers its Firebase token (`alert-87199` project,
`google-services.json` already in `app/`) via `POST /api/devices`, and the
server pushes instantly over FCM HTTP v1. Polling stays as a cheap fallback —
once push shows ON in the app, set the interval to 120s+ to save battery.

Native Kotlin app that **plays a loud alarm sound** when your Price-Alert website triggers.

How it works:
- Website backend records every crossing + manual test into `GET /api/triggered`
  (local `data/triggered.json`, Cloudflare Durable Object `triggeredEvents`).
- The app runs a foreground service (`AlertMonitorService`) that polls
  `/api/triggered?since=...` every 15–300s (default 30s).
- On a new event id it loops the system alarm tone, vibrates, shows a
  full-screen notification + `AlertAlarmActivity` with a STOP button.
- `POST /api/test-alert` (new “Test phone sound” button on the Alert page,
  and the app’s test button) creates an event so you can verify sound.
- Optional FCM push: `POST /api/devices` stores push tokens; if
  `FCM_SERVER_KEY` is set, the server also sends legacy FCM high-priority
  pushes. Polling works without Firebase.

## 1. Open in Android Studio

1. Open folder `android-app/` in Android Studio (Hedgehog+).
2. Let Gradle sync. `minSdk 26`, `target/compileSdk 34`.
3. Run on a real phone (emulator alarms are quiet).

No `google-services.json` needed for polling. FCM is optional:
comment out `firebase-messaging` in `app/build.gradle.kts` + remove
`PriceAlertMessagingService` from the manifest if you don’t use Firebase.

## 2. Point the app at your site

- **Local test:** run `npm start` on your PC, find your LAN IP
  (`ipconfig` → e.g. `192.168.1.50`), enter
  `http://192.168.1.50:3000` in the app. Leave user/pass empty.
  Make sure the phone is on the same Wi-Fi and Windows Firewall allows port 3000.
- **Cloudflare:** enter `https://<your-worker>.workers.dev` plus the
  `DASHBOARD_USER` / `DASHBOARD_PASSWORD` you set with wrangler.

Then: Save → Start monitoring → allow notifications → disable battery
optimization for “PriceAlert Sound” → press “Send test sound from website”.

## 3. Website endpoints added

- `GET /api/triggered?since=ISO` → `[{id, pair, target, note, channel, source, triggeredAt}]`
- `POST /api/test-alert {pair?, target?, note?}` → creates event, returns it
- `POST /api/devices {pushToken, platform}` → registers phone for FCM
- `GET /api/alert-card?pair=&target=&note=` → same HTML Telegram/Bale screenshots are taken from
- `GET /api/alert-image?pair=&target=&note=` → same PNG Telegram/Bale receive (Playwright locally, Browser Rendering on Cloudflare); the app shows this image big in the notification + full-screen alarm screen

Real crossings call the same path: after `alertSender` succeeds (or fails),
the server records a triggered event, so the phone rings even if
Telegram/Bale is down.

## 4. FCM push (configured)

Firebase project `alert-87199`, app id `alertapp.akhalteke.com`
(`app/google-services.json`, git-ignored). The app auto-registers its token
on launch and on token refresh (`MainActivity.registerPushToken`,
`PriceAlertMessagingService.onNewToken` → `POST /api/devices`).

One step left — server needs permission to send. Firebase Console →
Project settings → Service accounts → Generate new private key, then:

```
# local .env (one line):
FCM_SERVICE_ACCOUNT={"type":"service_account",...}

# Cloudflare:
npx wrangler secret put FCM_SERVICE_ACCOUNT
```

Server code (`js/fcmV1.js`, shared by Node + Worker, no npm deps) exchanges
the key for an access token and sends HTTP v1 high-priority pushes with the
card image data. Legacy `FCM_SERVER_KEY` remains as fallback for old
projects. Polling still runs as fallback.

## Files

- `app/src/main/.../MainActivity.kt` — server URL + start/stop/test UI
- `.../AlertMonitorService.kt` — foreground polling service
- `.../AlarmPlayer.kt` — looping alarm + vibration + notification
- `.../AlertAlarmActivity.kt` — full-screen STOP screen
- `.../Api.kt`, `Prefs.kt`, `BootReceiver.kt`, `PriceAlertMessagingService.kt`
