import { Platform } from "react-native";

// Didone/Bodoni on iOS, the system serif elsewhere. No font download: the
// web app uses the same system-stack approach in E1.
export const displayFont = Platform.select({
  ios: "Didot",
  android: "serif",
  default: "Georgia",
}) ?? "Georgia";
