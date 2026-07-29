import { BONUS_OFFERS, type BonusOffer } from "../config/bonuses";
import { COVERED_BOOKMAKER_KEYS } from "./bookmakerMap";
import { fetchLeagueOdds, type OddsApiEvent } from "./oddsApiClient";
import { resolveLeagueKeys, type SportGroup } from "./leagueCatalog";
import { parseMatchText, teamsMatch, detectPickedSide } from "./matching";

export interface BetterOffer {
  house: BonusOffer;
  odds: number;
}

function detectSportGroup(sport: string): SportGroup | null {
  if (/f[uú]tbol|football|soccer/i.test(sport)) return "futbol";
  if (/tenis|tennis/i.test(sport)) return "tenis";
  return null;
}

export interface FindBetterOddsParams {
  sport: string;
  betType: "simple" | "combinada";
  matchText: string;
  currentOdds: number;
  apiKey: string | undefined;
}

/**
 * Busca si alguna de las casas afiliadas cubiertas por la API ofrece mejor
 * cuota que la registrada. Deliberadamente limitado: solo apuestas simples,
 * solo fútbol/tenis, solo mercado ganador (1X2 / gana el partido) y solo
 * cuando el partido se identifica sin ambigüedad. Cualquier otro caso
 * devuelve un array vacío en vez de arriesgar una comparación incorrecta.
 */
export async function findBetterOdds(params: FindBetterOddsParams): Promise<BetterOffer[]> {
  if (!params.apiKey) return [];
  if (params.betType !== "simple") return [];

  const sportGroup = detectSportGroup(params.sport);
  if (!sportGroup) return [];

  const parsed = parseMatchText(params.matchText);
  if (!parsed) return [];

  let leagueKeys: string[];
  try {
    leagueKeys = await resolveLeagueKeys(params.apiKey, sportGroup);
  } catch (err) {
    console.error("No se pudo resolver el catálogo de ligas de la API de cuotas:", err);
    return [];
  }

  for (const leagueKey of leagueKeys) {
    let events: OddsApiEvent[];
    try {
      events = await fetchLeagueOdds(leagueKey, params.apiKey);
    } catch (err) {
      console.error(`No se pudo consultar cuotas de ${leagueKey}:`, err);
      continue;
    }

    const candidates = events.filter(
      (event) =>
        (teamsMatch(event.home_team, parsed.homeCandidate) && teamsMatch(event.away_team, parsed.awayCandidate)) ||
        (teamsMatch(event.home_team, parsed.awayCandidate) && teamsMatch(event.away_team, parsed.homeCandidate))
    );
    // 0 candidatos: no está en esta liga, se sigue probando la siguiente.
    // 2+: ambiguo, no se arriesga — se corta aquí sin mirar más ligas.
    if (candidates.length === 0) continue;
    if (candidates.length > 1) return [];

    const event = candidates[0];
    const side = detectPickedSide(parsed.selectionText, event.home_team, event.away_team);
    if (!side) return [];

    const outcomeName = side === "home" ? event.home_team : side === "away" ? event.away_team : "Draw";
    return offersAbovePrice(event, outcomeName, params.currentOdds);
  }

  return [];
}

function offersAbovePrice(event: OddsApiEvent, outcomeName: string, currentOdds: number): BetterOffer[] {
  const offers: BetterOffer[] = [];

  for (const house of BONUS_OFFERS) {
    const keys = COVERED_BOOKMAKER_KEYS[house.name];
    if (!keys) continue;

    let bestPrice: number | null = null;
    for (const bookmaker of event.bookmakers) {
      if (!keys.includes(bookmaker.key)) continue;
      const market = bookmaker.markets.find((m) => m.key === "h2h");
      const outcome = market?.outcomes.find((o) => o.name === outcomeName);
      if (outcome && (bestPrice === null || outcome.price > bestPrice)) {
        bestPrice = outcome.price;
      }
    }

    if (bestPrice !== null && bestPrice > currentOdds) {
      offers.push({ house, odds: bestPrice });
    }
  }

  return offers.sort((a, b) => b.odds - a.odds);
}
