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

function buildPrompt(detailed: DetailedStats): string {
  const lines = [
    summaryLine("Simple", detailed.simple),
    summaryLine("Combinada", detailed.combinada),
    ...detailed.bySport.map((s) => summaryLine(s.sport, s.summary)),
  ];

  return `Estos son los resultados de apuestas deportivas de un usuario, agrupados por tipo y por deporte:

${lines.join("\n")}

Escribe un análisis MUY escueto (máximo 5 líneas, sin rodeos) en español: dónde gana, dónde pierde, y qué debería hacer para mejorar sus números. No repitas los datos numéricos que ya tiene, ve directo a la conclusión práctica. Responde en texto plano, sin markdown (nada de asteriscos, guiones de lista ni almohadillas).`;
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
