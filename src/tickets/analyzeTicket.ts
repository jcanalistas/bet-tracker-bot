import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../gemini/retry";

export type BetType = "simple" | "combinada";

export interface TicketInfo {
  sport: string;
  competition: string;
  selections: string;
  betType: BetType;
  /** Cuota total del ticket, tal como aparece en la imagen (ej. "1,91"). Vacío si no se pudo leer. */
  odds: string;
  /** Importe apostado (stake), tal como aparece en la imagen. Vacío si no se pudo leer con claridad. */
  stake: string;
}

const ANALYSIS_MODEL = "gemini-flash-latest";

const ANALYZE_PROMPT = `Analiza esta imagen de un ticket de apuesta deportiva de una casa de apuestas online. Puede ser de cualquier deporte, y tener una única selección (simple) o varias combinadas en el mismo ticket.

Devuelve tu respuesta EXACTAMENTE en este formato, una línea por campo, sin nada más:
DEPORTE: <deporte del ticket, ej. "Fútbol", "Tenis", "Baloncesto", "Balonmano">
COMPETICION: <competición o torneo exacto según lo que veas en el ticket, ej. "LaLiga", "ATP Madrid", "NBA">
SELECCIONES: <resumen breve de la selección o selecciones, combinando equipo/jugador y mercado de cada una, unidas por " + " si hay varias>
TIPO: <"simple" si el ticket tiene una única selección, "combinada" si tiene dos o más>
CUOTA: <cuota total del ticket tal como aparece en la imagen, con coma decimal, ej. 1,91>
IMPORTE: <importe apostado (stake) tal como aparece en la imagen, solo el número con coma decimal y sin símbolo de moneda, ej. 10. Si no aparece con claridad en el ticket, escribe exactamente SIN_DATO>`;

const ANALYZE_TIMEOUT_MS = 90_000;
const ANALYZE_RETRIES = 2;
const ANALYZE_RETRY_BASE_DELAY_MS = 3_000;

/** Usa la visión de Gemini para leer el ticket y extraer deporte, competición, selecciones, tipo, cuota e importe. */
export async function analyzeTicket(ticketBuffer: Buffer, apiKey: string): Promise<TicketInfo> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: ANALYZE_TIMEOUT_MS } });

  const response = await withRetry(
    () =>
      withTimeout(
        client.models.generateContent({
          model: ANALYSIS_MODEL,
          contents: [
            { text: ANALYZE_PROMPT },
            { inlineData: { mimeType: "image/jpeg", data: ticketBuffer.toString("base64") } },
          ],
        }),
        ANALYZE_TIMEOUT_MS,
        "Tiempo de espera agotado analizando el ticket"
      ),
    { retries: ANALYZE_RETRIES, baseDelayMs: ANALYZE_RETRY_BASE_DELAY_MS }
  );

  return parseTicketInfo(response.text ?? "");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (${ms / 1000}s)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function parseTicketInfo(text: string): TicketInfo {
  // Igual que en JC-Analistas: quitar símbolos de énfasis por si el modelo
  // devuelve los campos envueltos en markdown pese a pedir texto plano.
  const cleaned = text.replace(/[*_`#]/g, "");

  const sportMatch = /DEPORTE:\s*(.+)/i.exec(cleaned);
  const competitionMatch = /COMPETICION:\s*(.+)/i.exec(cleaned);
  const selectionsMatch = /SELECCIONES:\s*(.+)/i.exec(cleaned);
  const typeMatch = /TIPO:\s*(simple|combinada)/i.exec(cleaned);
  const oddsMatch = /CUOTA:\s*(.+)/i.exec(cleaned);
  const stakeMatch = /IMPORTE:\s*(.+)/i.exec(cleaned);

  const sport = sportMatch?.[1]?.trim() ?? "";
  const competition = competitionMatch?.[1]?.trim() ?? "";
  const selections = selectionsMatch?.[1]?.trim() ?? "";
  const betType: BetType = /combinada/i.test(typeMatch?.[1] ?? "") ? "combinada" : "simple";
  const odds = oddsMatch?.[1]?.trim() ?? "";
  const rawStake = stakeMatch?.[1]?.trim() ?? "";
  const stake = /SIN_DATO/i.test(rawStake) ? "" : rawStake;

  if (!sport || !selections) {
    throw new Error(`No se pudo extraer la información del ticket. Respuesta recibida: ${text.slice(0, 300)}`);
  }

  return { sport, competition, selections, betType, odds, stake };
}
