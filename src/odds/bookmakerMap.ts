// Solo las casas de src/config/bonuses.ts que The Odds API cubre de verdad
// (comprobado a mano consultando su API: Sportium y PokerStars no aparecen
// en ninguna región, así que se quedan fuera del comparador aunque sigan
// apareciendo en 🎁 Bonos Bienvenida). La clave de este objeto debe
// coincidir exactamente con el "name" de bonuses.ts.
export const COVERED_BOOKMAKER_KEYS: Record<string, string[]> = {
  Winamax: ["winamax_de", "winamax_fr"],
  Betfair: ["betfair_ex_eu", "betfair_ex_uk", "betfair_sb_uk"],
  "William Hill": ["williamhill"],
  Betway: ["betway"],
  "888 Sport": ["sport888"],
};
