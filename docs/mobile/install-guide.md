# DualTran on mobile — install guide & verification protocol

Status: **user guidance, not yet developer-tested on mobile hardware.** The
desktop dual-span layout is adaptive, but small-screen UI density is
unverified. If you try any of these paths, please report what you see via
https://github.com/seigwen/DualTran-extension/issues (template below).

## Android — Vivaldi (Chromium engine)

Vivaldi for Android supports Chrome extensions from the Chrome Web Store.

1. Install Vivaldi from the Play Store.
2. Open the DualTran Chrome Web Store listing **inside Vivaldi**
   (`chromewebstore.google.com`).
3. Tap **Add to Vivaldi** / **Add to Chrome** and confirm.
4. Open any page, look for the DualTran floating button (bottom-right).

## Android — Firefox (Gecko engine)

Once the Firefox build passes AMO review, it becomes installable from the AMO
listing on **Firefox for Android**. Caveat: the stable channel may show only
"recommended" add-ons — if DualTran is not offered on your channel, Firefox
**Beta / Nightly** can install any AMO extension.

1. Open the AMO listing **inside Firefox for Android**.
2. Tap **Add to Firefox** → **Allow**.
3. Test the same flow as desktop (floating button / Alt+T is desktop-only; use
   the floating button).

## iOS / iPadOS — Orion Browser (WebKit wrapper, Kagi)

Orion supports installing extensions from both the Chrome Web Store and AMO.

1. Install Orion from the App Store.
2. Orion menu → **Extensions** → enable **Allow Unsure/Unsupported Extensions**
   if prompted.
3. Install DualTran from the Chrome Web Store page (the Chromium package is
   the intended install for Orion).
4. Test on a foreign-language page.

## Verification protocol (what to check)

1. Floating button appears bottom-right; tap it → pages gets bilingual content
   (translated text below originals, second color).
2. Open the options page (gear on the floating button) — settings render and
   scroll correctly on a narrow screen.
3. Select some text → selection popup appears near the selection and translates.
4. Report anything odd with: device + OS version, browser + version, page URL,
   screenshot, and whether #1/#2/#3 passed or failed.
