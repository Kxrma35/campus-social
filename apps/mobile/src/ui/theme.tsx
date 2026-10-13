import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { palettes } from "@/theme/tokens";
import type { Palette, Scheme } from "@/theme/tokens";

const Ctx = createContext<Palette>(palettes.light);

export function ThemeProvider({ children, scheme }: { children: ReactNode; scheme?: Scheme }) {
  const system = useColorScheme();
  const resolved: Scheme = scheme ?? (system === "dark" ? "dark" : "light");
  return <Ctx.Provider value={palettes[resolved]}>{children}</Ctx.Provider>;
}

export function useTheme(): Palette {
  return useContext(Ctx);
}
