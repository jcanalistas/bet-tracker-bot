export interface BonusOffer {
  name: string;
  url: string;
  /** Texto corto del bono, ej. "Hasta 100€ en tu primer depósito". Opcional. */
  bonus?: string;
}

// Casas de apuestas con enlace de referido y su bono de bienvenida. Edita
// esta lista para añadir, quitar o cambiar casas — el botón "🎁 Bonos
// Bienvenida" del bot las muestra en este mismo orden.
export const BONUS_OFFERS: BonusOffer[] = [];
