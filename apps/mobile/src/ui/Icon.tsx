import { Platform } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

export type IconName =
  | "heart"
  | "heartFilled"
  | "comment"
  | "more"
  | "image"
  | "home"
  | "bell"
  | "person"
  | "chevronRight"
  | "plus"
  | "flag"
  | "close"
  | "lock";

const PATHS: Record<IconName, { d: string; fill?: boolean }[]> = {
  heart: [
    {
      d: "M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.4 3.3 4.2 6.7C19.5 15.9 12 20.5 12 20.5z",
    },
  ],
  heartFilled: [
    {
      d: "M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.4 3.3 4.2 6.7C19.5 15.9 12 20.5 12 20.5z",
      fill: true,
    },
  ],
  comment: [{ d: "M4 5.5h16a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" }],
  more: [],
  image: [
    { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
    { d: "M3 16.5l5-5 4 4 3-3 6 6" },
  ],
  home: [{ d: "M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" }],
  bell: [
    { d: "M6 17h12l-1.6-2.4V10.5a4.4 4.4 0 0 0-8.8 0v4.1z" },
    { d: "M10 20a2 2 0 0 0 4 0" },
  ],
  person: [
    { d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
    { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" },
  ],
  chevronRight: [{ d: "M9 5l7 7-7 7" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  flag: [{ d: "M5 21V4M5 4h12l-2 4 2 4H5" }],
  close: [{ d: "M6 6l12 12M18 6L6 18" }],
  lock: [
    { d: "M6 11h12v9H6z" },
    { d: "M8.5 11V8a3.5 3.5 0 0 1 7 0v3" },
  ],
};

const hiddenFromReaders =
  Platform.OS === "web"
    ? ({ "aria-hidden": true } as object)
    : { accessibilityElementsHidden: true, importantForAccessibility: "no" as const };

export function Icon({
  name,
  size = 24,
  color,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...hiddenFromReaders}>
      {name === "more" ? (
        <>
          <Circle cx="5.5" cy="12" r="1.6" fill={color} />
          <Circle cx="12" cy="12" r="1.6" fill={color} />
          <Circle cx="18.5" cy="12" r="1.6" fill={color} />
        </>
      ) : (
        PATHS[name].map((p, i) => (
          <Path
            key={i}
            d={p.d}
            fill={p.fill ? color : "none"}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))
      )}
    </Svg>
  );
}
