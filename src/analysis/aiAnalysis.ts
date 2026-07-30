import { GoogleGenAI } from "@google/genai";
import { withRetry, withTimeout } from "../gemini/retry";
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

function stakeSizeLine(s: DetailedStats["byStakeSize"][number]): string {
  return `${s.label}: ${s.total} apuestas, ${s.won} ganadas, ${s.lost} perdidas, acierto ${formatMoney(s.hitRate)}%, beneficio ${formatMoney(s.netProfit)}€`;
}

function streakLine(streak: DetailedStats["streak"]): string {
  if (streak.type === null) return "Sin apuestas resueltas todavía.";
  return `${streak.count} ${streak.type === "ganada" ? "ganadas" : "perdidas"} seguidas (la más reciente primero).`;
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
    "",
    "Por tamaño de la apuesta (comparado con su importe medio):",
    ...detailed.byStakeSize.map(stakeSizeLine),
    "",
    "Racha actual:",
    streakLine(detailed.streak),
  ];

  return `Estos son los resultados de apuestas deportivas de un usuario, agrupados por tipo, por deporte, por rango de cuota, por tamaño de apuesta, más su racha actual:

${lines.join("\n")}

Escribe un análisis MUY escueto (máximo 8 líneas, sin rodeos) en español, con conclusiones prácticas y accionables:
1. Qué deporte y qué tipo (simple/combinada) le rinde mejor, y cuál peor.
2. En qué rango de cuota acierta más — para que sepa en qué centrarse.
3. Si las apuestas grandes rinden distinto que las pequeñas (y si debería ajustar el importe).
4. Si la racha actual merece un aviso (p. ej. varias perdidas seguidas: sugiere prudencia; no interpretes una racha corta como algo estadísticamente significativo).
5. Una recomendación concreta para mejorar sus números (no un consejo genérico como "gestiona bien tu dinero").

No repitas los datos numéricos que ya tiene, ve directo a la conclusión. Si algún grupo tiene muy pocas apuestas (menos de 5), acláralo como dato poco fiable en vez de sacar una conclusión fuerte de él. Responde en texto plano, sin markdown (nada de asteriscos, guiones de lista ni almohadillas).`;
}

/** Análisis breve generado por Gemini a partir del desglose de stats (dónde gana/pierde, qué mejorar). */
export async function generateBettingAnalysis(detailed: DetailedStats, apiKey: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  const prompt = buildPrompt(detailed);

  const response = await withRetry(
    () =>
      withTimeout(
        client.models.generateContent({
          model: ANALYSIS_MODEL,
          contents: [{ text: prompt }],
          // Es un resumen de texto a partir de datos ya calculados, no un
          // problema que requiera razonar: sin esto, Gemini 2.5 Flash mete
          // un presupuesto de "pensamiento" automático que puede tardar
          // minutos para una tarea así de simple.
          config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 400 },
        }),
        TIMEOUT_MS,
        "Tiempo de espera agotado generando el análisis"
      ),
    { retries: RETRIES, baseDelayMs: RETRY_BASE_DELAY_MS }
  );

  return response.text?.trim() || "No se pudo generar el análisis.";
}
