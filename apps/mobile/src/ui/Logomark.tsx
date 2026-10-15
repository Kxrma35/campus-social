import Svg, { Circle } from "react-native-svg";
import { hiddenFromReaders } from "./a11y";
import { useTheme } from "./theme";

/** Placeholder mark: two overlapping translucent circles. Decorative. */
export function Logomark({ size = 44 }: { size?: number }) {
  const t = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      {...hiddenFromReaders}
    >
      <Circle cx="19" cy="19" r="13" fill={t.accentLavender} fillOpacity={0.75} />
      <Circle cx="29" cy="29" r="13" fill={t.accentPink} fillOpacity={0.7} />
    </Svg>
  );
}
