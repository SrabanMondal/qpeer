# INC-073: The APK carried native libraries for emulators

| Field | Value |
|---|---|
| Date found | 2026-11-14 |
| Severity | S3 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | none |

## Summary

The preview APK was 213 MB. It held the native libraries (Mapbox, Hermes, Firebase and others) four times, once per processor type: `arm64-v8a` 47 MB, `armeabi-v7a` 32 MB, `x86` 52 MB and `x86_64` 51 MB. Phones use only the arm types. The x86 types are for emulators.

## Impact

Testers downloaded and installed about 103 MB that their phones never use.

## Detection

The owner asked why the app is large. A size breakdown of `qpeer-preview-fixes.apk` (`unzip -l`) showed the four library folders.

## Timeline

Unknown.

## Root cause

Expo builds all four Android ABIs by default (`expo-build-properties` `android.buildArchs` default).

## Fix

`apps/mobile/app.config.ts`: `expo-build-properties` `android.buildArchs: ["armeabi-v7a", "arm64-v8a"]`. Commit a74a82f.

## Verification

EAS preview build `00388aa6-…` (2026-11-14): the APK is 109 MB and holds only `lib/arm64-v8a` and `lib/armeabi-v7a`. Not yet installed on a phone.

## Follow-ups

1. Install the slim APK on the phone and make sure that it starts, the map loads and payments work.
2. Optional: R8 code shrinking (`enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`) with a full phone test.
3. A Play Store release (AAB) delivers only the right ABI to each phone.

## Lessons

Check what is inside a build before you share it. A size breakdown takes one command.
