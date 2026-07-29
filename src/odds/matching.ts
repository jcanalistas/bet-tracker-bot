// Emparejar el "partido" leído del ticket (texto libre de Gemini) con el
// evento/equipo exacto de la API de cuotas. Deliberadamente conservador: si
// hay cualquier ambigüedad, no se intenta adivinar — es preferible no
// mostrar nada a mostrar una comparación de cuotas equivocada.

const STOPWORDS = new Set(["cf", "fc", "cd", "ud", "sd", "club", "de"]);

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function tokenize(name: string): string[] {
  return stripAccents(name.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/** Similitud por solapamiento de palabras (Jaccard). >=0.5 se considera el mismo equipo. */
export function teamsMatch(a: string, b: string): boolean {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return overlap / union >= 0.5;
}

export interface ParsedFixture {
  homeCandidate: string;
  awayCandidate: string;
  selectionText: string;
}

/** "Real Madrid vs Barcelona — Gana Real Madrid" -> equipos + texto de la selección. Null si el formato no se reconoce. */
export function parseMatchText(matchText: string): ParsedFixture | null {
  const parts = matchText.split(/\s+—\s+|\s+-\s+/);
  if (parts.length < 2) return null;

  const fixturePart = parts[0];
  const selectionText = parts.slice(1).join(" - ").trim();

  const teams = fixturePart.split(/\s+vs\.?\s+/i);
  if (teams.length !== 2) return null;

  const homeCandidate = teams[0].trim();
  const awayCandidate = teams[1].trim();
  if (!homeCandidate || !awayCandidate || !selectionText) return null;

  return { homeCandidate, awayCandidate, selectionText };
}

/** ¿La selección apunta al local, al visitante o al empate? Null si no se puede determinar con confianza. */
export function detectPickedSide(
  selectionText: string,
  homeTeam: string,
  awayTeam: string
): "home" | "away" | "draw" | null {
  const selectionTokens = new Set(tokenize(selectionText));
  const homeTokens = new Set(tokenize(homeTeam));
  const awayTokens = new Set(tokenize(awayTeam));

  const homeOverlap = [...selectionTokens].filter((t) => homeTokens.has(t)).length;
  const awayOverlap = [...selectionTokens].filter((t) => awayTokens.has(t)).length;

  if (homeOverlap > 0 && homeOverlap > awayOverlap) return "home";
  if (awayOverlap > 0 && awayOverlap > homeOverlap) return "away";
  if (homeOverlap === 0 && awayOverlap === 0 && /\b(empate|draw|equis|\bx\b)\b/i.test(selectionText)) return "draw";
  return null;
}
