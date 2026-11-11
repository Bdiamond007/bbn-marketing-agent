/** Tokens du design system noir/blanc/or (SPECIFICATION §8). */
export const colors = {
  black: "#0B0B0D",
  white: "#FFFFFF",
  gold: "#D4AF37",
  goldDark: "#806000",
  goldSoft: "#F7F0D8",
  background: "#F7F7F8",
  text: "#17171A",
  textSecondary: "#55555E",
  border: "#D6D6DC",
  error: "#B42318",
  success: "#17633B",
  info: "#175CD3",
} as const;

export const spacing = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const radii = { sm: 8, md: 12 } as const;
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export const typography = { fontFamily: "Inter, system-ui, sans-serif", baseSizePx: 16, lineHeight: 1.5 } as const;
export const minTouchTargetPx = 44;
