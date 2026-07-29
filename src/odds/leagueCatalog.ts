import { fetchSportsList } from "./oddsApiClient";

export type SportGroup = "futbol" | "tenis";

// Ligas de fútbol fijas que queremos comprobar siempre que estén en el
// catálogo. Champions League usa prefijo porque la API la parte en varias
// claves según la fase (clasificación, fase de grupos...) y solo alguna
// estará activa según la época del año.
const FOOTBALL_LEAGUE_KEYS = ["soccer_epl", "soccer_germany_bundesliga", "soccer_spain_la_liga"];
const FOOTBALL_KEY_PREFIXES = ["soccer_uefa_champs_league"];

// El tenis no tiene una clave fija "ATP"/"WTA": cada torneo tiene su propia
// clave (p. ej. tennis_atp_washington_open) que aparece y desaparece del
// catálogo semana a semana según el calendario. Hay que resolverlas en
// tiempo real contra /v4/sports en vez de hardcodear ninguna.
const TENNIS_KEY_PREFIXES = ["tennis_atp", "tennis_wta"];

interface CatalogCache {
  keys: string[];
  expiresAt: number;
}

let cache: CatalogCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h: el calendario de torneos no cambia con más frecuencia que eso

/** Claves de sport_key de la API que hay que comprobar para este grupo de deporte, resueltas contra el catálogo en vivo. */
export async function resolveLeagueKeys(apiKey: string, sportGroup: SportGroup): Promise<string[]> {
  const now = Date.now();
  if (!cache || cache.expiresAt < now) {
    const sports = await fetchSportsList(apiKey);
    cache = { keys: sports.map((s) => s.key), expiresAt: now + CACHE_TTL_MS };
  }

  if (sportGroup === "futbol") {
    return cache.keys.filter(
      (key) => FOOTBALL_LEAGUE_KEYS.includes(key) || FOOTBALL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
  }

  return cache.keys.filter((key) => TENNIS_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)));
}
