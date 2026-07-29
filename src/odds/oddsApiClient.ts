export interface OddsApiOutcome {
  name: string;
  price: number;
}

export interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  active: boolean;
}

const BASE_URL = "https://api.the-odds-api.com/v4";

/** Catálogo de deportes/torneos actualmente activos en la API (claves de tenis cambian semana a semana). */
export async function fetchSportsList(apiKey: string): Promise<OddsApiSport[]> {
  const url = `${BASE_URL}/sports/?apiKey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`La API de cuotas respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

/** Cuotas 1X2/ganador (h2h) de una liga o torneo, combinando regiones eu+uk en una sola llamada (2 créditos: 1 mercado x 2 regiones). */
export async function fetchLeagueOdds(sportKey: string, apiKey: string): Promise<OddsApiEvent[]> {
  const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu,uk&markets=h2h&oddsFormat=decimal`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`La API de cuotas respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}
