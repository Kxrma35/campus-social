import { Platform } from "react-native";

/** Hide decorative content from screen readers, with the right props per platform. */
export const hiddenFromReaders: object =
  Platform.OS === "web"
    ? { "aria-hidden": true }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" };
