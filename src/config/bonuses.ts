export interface BonusOffer {
  name: string;
  url: string;
  /** Texto corto del bono, ej. "Hasta 100€ en tu primer depósito". Opcional. */
  bonus?: string;
}

// Casas de apuestas con enlace de referido y su bono de bienvenida. Edita
// esta lista para añadir, quitar o cambiar casas — el botón "🎁 Bonos
// Bienvenida" del bot las muestra en este mismo orden.
export const BONUS_OFFERS: BonusOffer[] = [
  { name: "888 Sport", url: "https://bdeal.io/888Sport/153574/1", bonus: "10€ gratis + 100€ en freebets" },
  { name: "Betfair", url: "https://bdeal.io/Betfair/149673/1", bonus: "Bono del 400% hasta 200€" },
  { name: "Betway", url: "https://bdeal.io/Betway/149672/1", bonus: "Hasta 200€ en Free Bets asegurados" },
  { name: "PokerStars", url: "https://bdeal.io/PokerStars/149674/1", bonus: "Bono hasta 100€" },
  { name: "Sportium", url: "https://bdeal.io/Sportium/153573/1", bonus: "Doble bono hasta 200€" },
  { name: "William Hill", url: "https://bdeal.io/WilliamHill/153389/1", bonus: "Bono de bienvenida hasta 150€" },
  { name: "Winamax", url: "https://bdeal.io/Winamax/147910/1", bonus: "Bono del 150% hasta 150€" },
];
