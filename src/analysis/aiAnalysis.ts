import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../gemini/retry";
import { formatMoney, type DetailedStats } from "../stats/betsStore";

const ANALYSIS_MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 30_000;
const RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2_000;

function summaryLine(label: string, s: { total: number; won: number; lost: number; netProfit: number }): string {
  return `${label}: ${s.total} apuestas, ${s.won} ganadas, ${s.lost} perdidas, beneficio ${formatMoney(s.netProfit)}€`;
}

function oddsRangeLine(r: DetailedStats["byOddsRange"][number]): string {
  return `Cuota ${r.range}: ${r.total} apuestas, ${r.won} ganadas, ${r.lost} perdidas, acierto ${formatMoney(r.hitRate)}%, beneficio ${formatMoney(r.netProfit)}€`;
}

function buildPrompt(detailed: DetailedStats): string {
  const lines = [
    "Por tipo:",
    summaryLine("Simple", detailed.simple),
    summaryLine("Combinada", detailed.combinada),
    "",
    "Por deporte:",
    ...detailed.bySport.map((s) => summaryLine(s.sport, s.summary)),
    "",
    "Por rango de cuota (solo apuestas resueltas):",
    ...detailed.byOddsRange.map(oddsRangeLine),
  ];

  return `Estos son los resultados de apuestas deportivas de un usuario, agrupados por tipo, por deporte y por rango de cuota:

${lines.join("\n")}

Escribe un análisis MUY escueto (máximo 6 líneas, sin rodeos) en español, con conclusiones prácticas y accionables:
1. Qué deporte y qué tipo (simple/combinada) le rinde mejor, y cuál peor.
2. En qué rango de cuota acierta más — para que sepa en qué centrarse.
3. Una recomendación concreta para mejorar sus números (no un consejo genérico como "gestiona bien tu dinero").

No repitas los datos numéricos que ya tiene, ve directo a la conclusión. Si algún grupo tiene muy pocas apuestas (menos de 5), acláralo como dato poco fiable en vez de sacar una conclusión fuerte de él. Responde en texto plano, sin markdown (nada de asteriscos, guiones de lista ni almohadillas).`;
}

/** Análisis breve generado por Gemini a partir del desglose de stats (dónde gana/pierde, qué mejorar). */
export async function generateBettingAnalysis(detailed: DetailedStats, apiKey: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  const prompt = buildPrompt(detailed);

  const response = await withRetry(
    () => client.models.generateContent({ model: ANALYSIS_MODEL, contents: [{ text: prompt }] }),
    { retries: RETRIES, baseDelayMs: RETRY_BASE_DELAY_MS }
  );

  return response.text?.trim() || "No se pudo generar el análisis.";
}
