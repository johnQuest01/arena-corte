/** Ícone curto da habilidade (HUD desktop e botão Q do celular). */
const GLYPHS: Record<number, string> = {
  0: "W",
  1: "G",
  2: "B",
  3: "R",
  4: "★",
  5: "F",
  6: "D",
  7: "E",
  8: "❄",
  9: "↺",
  10: "ϟ",
  11: "»",
};

export function abilityGlyph(id?: number): string {
  return GLYPHS[id ?? 0] ?? "?";
}
