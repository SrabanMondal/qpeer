import type { ConfigContext, ExpoConfig } from "expo/config";

// React Native Firebase pods. With static frameworks (iOS, future) every RNFB
// module in use must be linked statically.
const RNFB_IOS_PODS = ["RNFBApp", "RNFBAuth"];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Qpeer",
  slug: "qpeer",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "qpeer",
  userInterfaceStyle: "automatic",
  ios: {
    icon: "./assets/expo.icon",
  },
  android: {
    package: "com.qpeer.app",
    // EAS cloud builds provide a file env var with this name; locally the
    // gitignored file next to this config is used.
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#208AEF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    // iOS only: use CocoaPods instead of SPM so static frameworks work.
    ["@react-native-firebase/app", { ios: { disableSPM: true } }],
    "@react-native-firebase/auth",
    // No options: the Firebase variant reads google-services.json.
    "@react-native-google-signin/google-signin",
    [
      "expo-build-properties",
      {
        // Android: RNFB 26 needs minSdk 23; Expo SDK 57 defaults are higher,
        // so nothing to override.
        ios: {
          useFrameworks: "static",
          forceStaticLinking: RNFB_IOS_PODS,
        },
      },
    ],
    "@rnmapbox/maps",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Qpeer checks you are near the business when you join its queue.",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Qpeer uses the camera to scan queue QR codes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "expo-notifications",
    "expo-dev-client",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "e7efb464-0b19-46a2-a074-768f3f99f5a3",
    },
  },
  owner: "sraban",
});
