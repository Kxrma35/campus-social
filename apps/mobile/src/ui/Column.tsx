import { View } from "react-native";
import type { ReactNode } from "react";

/** One centred reading column, 640pt at most, so wide screens line up with the feed. */
export function Column({ children, gap = 0 }: { children: ReactNode; gap?: number }) {
  return <View style={{ width: "100%", maxWidth: 640, alignSelf: "center", gap }}>{children}</View>;
}
