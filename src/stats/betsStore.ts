import type { DocumentSnapshot } from "@google-cloud/firestore";
import { firestore } from "./firestore";
import type { BetType } from "../tickets/analyzeTicket";

export type BetStatus = "pendiente" | "ganada" | "perdida" | "nula" | "cashout";

export interface BetInput {
  /** ID de usuario de Telegram, como string. Aísla los datos de cada usuario. */
  userId: string;
  sport: string;
  match: string;
  betType: BetType;
  /** Cuota leída del ticket al registrar; es la que cuenta para el beneficio al marcar Ganada. */
  estimatedOdds: number | null;
  stake: number;
}

export interface Bet extends BetInput {
  id: string;
  status: BetStatus;
  createdAt: number;
  resolvedAt?: number;
  realOdds?: number;
  profit?: number;
}

const COLLECTION = "bets";

export async function createPendingBet(input: BetInput): Promise<string> {
  const doc = await firestore.collection(COLLECTION).add({
    ...input,
    status: "pendiente" satisfies BetStatus,
    createdAt: Date.now(),
  });
  return doc.id;
}

export async function getBet(id: string): Promise<Bet | null> {
  const snapshot = await firestore.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) return null;
  return toBet(snapshot);
}

export async function getPendingBets(userId: string): Promise<Bet[]> {
  const snapshot = await firestore
    .collection(COLLECTION)
    .where("userId", "==", userId)
    .where("status", "==", "pendiente")
    .get();
  return snapshot.docs.map(toBet).sort((a, b) => b.createdAt - a.createdAt);
}

export async function markBetLost(id: string): Promise<number> {
  const bet = await getBet(id);
  if (!bet) throw new Error(`Apuesta no encontrada: ${id}`);
  const profit = -bet.stake;
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "perdida" satisfies BetStatus, resolvedAt: Date.now(), profit });
  return profit;
}

/** Marca la apuesta como ganada con la cuota REAL obtenida (no la estimada al leer el ticket) y devuelve el beneficio calculado. */
export async function markBetWon(id: string, realOdds: number): Promise<number> {
  const bet = await getBet(id);
  if (!bet) throw new Error(`Apuesta no encontrada: ${id}`);
  const profit = cleanFloat(bet.stake * (realOdds - 1));
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "ganada" satisfies BetStatus, resolvedAt: Date.now(), realOdds, profit });
  return profit;
}

/** Apuesta nula/anulada por la casa (partido suspendido, etc.): se devuelve el importe, beneficio 0. */
export async function markBetVoid(id: string): Promise<void> {
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "nula" satisfies BetStatus, resolvedAt: Date.now(), profit: 0 });
}

/** Cashout: el beneficio (o pérdida) lo escribe el usuario a mano, puede ser negativo. */
export async function markBetCashout(id: string, profit: number): Promise<void> {
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "cashout" satisfies BetStatus, resolvedAt: Date.now(), profit: cleanFloat(profit) });
}

/** Borra la apuesta por completo (registrada por error) — no queda ni rastro en las estadísticas. */
export async function deleteBet(id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).delete();
}

export type StatsPeriod = "mes" | "anio" | "historico";

export interface StatsSummary {
  total: number;
  pending: number;
  won: number;
  lost: number;
  hitRate: number; // % sobre las resueltas (ganadas + perdidas)
  netProfit: number;
}

/** Rango [from, to) en ms desde epoch para el periodo pedido, o null si es histórico (sin filtrar). */
function periodRange(period: StatsPeriod): { from: number; to: number } | null {
  if (period === "historico") return null;

  const now = new Date();
  if (period === "mes") {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
    };
  }

  return {
    from: new Date(now.getFullYear(), 0, 1).getTime(),
    to: new Date(now.getFullYear() + 1, 0, 1).getTime(),
  };
}

export interface StatsOptions {
  /** "simple" / "combinada" filtran por tipo; cualquier otro texto filtra por deporte (coincidencia parcial, sin distinguir mayúsculas). */
  filter?: string;
  period?: StatsPeriod;
}

async function getUserBets(userId: string, options: StatsOptions): Promise<Bet[]> {
  const snapshot = await firestore.collection(COLLECTION).where("userId", "==", userId).get();
  let bets = snapshot.docs.map(toBet);

  const range = periodRange(options.period ?? "historico");
  if (range) {
    bets = bets.filter((b) => b.createdAt >= range.from && b.createdAt < range.to);
  }

  if (options.filter) {
    const normalized = options.filter.trim().toLowerCase();
    if (normalized === "simple" || normalized === "combinada") {
      bets = bets.filter((b) => b.betType === normalized);
    } else {
      bets = bets.filter((b) => b.sport.toLowerCase().includes(normalized));
    }
  }

  return bets;
}

function summarize(bets: Bet[]): StatsSummary {
  const pending = bets.filter((b) => b.status === "pendiente").length;
  // El cashout no tiene un "ganada"/"perdida" explícito: se clasifica por
  // el signo del beneficio que escribió el usuario. Las nulas no cuentan
  // ni como acierto ni como fallo (sí entran en "total").
  const won = bets.filter((b) => b.status === "ganada" || (b.status === "cashout" && (b.profit ?? 0) > 0)).length;
  const lost = bets.filter((b) => b.status === "perdida" || (b.status === "cashout" && (b.profit ?? 0) <= 0)).length;
  const resolved = won + lost;
  const netProfit = cleanFloat(bets.reduce((sum, b) => sum + (b.profit ?? 0), 0));
  const hitRate = resolved > 0 ? cleanFloat((won / resolved) * 100) : 0;

  return { total: bets.length, pending, won, lost, hitRate, netProfit };
}

export async function getStatsSummary(userId: string, options: StatsOptions = {}): Promise<StatsSummary> {
  const bets = await getUserBets(userId, options);
  return summarize(bets);
}

export interface OddsRangeStats {
  range: string;
  total: number;
  won: number;
  lost: number;
  hitRate: number;
  netProfit: number;
}

export interface DetailedStats {
  bySport: { sport: string; summary: StatsSummary }[];
  simple: StatsSummary;
  combinada: StatsSummary;
  /** Desglose por rango de cuota (solo resueltas), para ver en qué franja se acierta más — usado por el Análisis IA. */
  byOddsRange: OddsRangeStats[];
}

const ODDS_RANGES: { label: string; min: number; max: number }[] = [
  { label: "< 1,50", min: 0, max: 1.5 },
  { label: "1,50 - 2,00", min: 1.5, max: 2 },
  { label: "2,00 - 3,00", min: 2, max: 3 },
  { label: "> 3,00", min: 3, max: Infinity },
];

/** La cuota real (si ganó) o la leída del ticket al registrar, para clasificar la apuesta por rango. Null si no hay ninguna. */
function oddsOf(bet: Bet): number | null {
  return bet.realOdds ?? bet.estimatedOdds ?? null;
}

function summarizeOddsRanges(bets: Bet[]): OddsRangeStats[] {
  const resolved = bets.filter((b) => b.status === "ganada" || b.status === "perdida" || b.status === "cashout");

  return ODDS_RANGES.map(({ label, min, max }) => {
    const inRange = resolved.filter((b) => {
      const odds = oddsOf(b);
      return odds !== null && odds >= min && odds < max;
    });
    const won = inRange.filter((b) => b.status === "ganada" || (b.status === "cashout" && (b.profit ?? 0) > 0)).length;
    const lost = inRange.length - won;
    const netProfit = cleanFloat(inRange.reduce((sum, b) => sum + (b.profit ?? 0), 0));
    const hitRate = inRange.length > 0 ? cleanFloat((won / inRange.length) * 100) : 0;
    return { range: label, total: inRange.length, won, lost, hitRate, netProfit };
  }).filter((r) => r.total > 0);
}

/** Desglose por deporte, por tipo (simple/combinada) y por rango de cuota en un único viaje a Firestore, para "⭐ Stats completas" y "⭐ Análisis IA". */
export async function getDetailedStats(userId: string, period: StatsPeriod): Promise<DetailedStats> {
  const bets = await getUserBets(userId, { period });

  const sports = [...new Set(bets.map((b) => b.sport))].sort((a, b) => a.localeCompare(b));
  const bySport = sports.map((sport) => ({ sport, summary: summarize(bets.filter((b) => b.sport === sport)) }));

  return {
    bySport,
    simple: summarize(bets.filter((b) => b.betType === "simple")),
    combinada: summarize(bets.filter((b) => b.betType === "combinada")),
    byOddsRange: summarizeOddsRanges(bets),
  };
}

/** Todas las apuestas del usuario que cumplen el filtro/periodo, en orden cronológico de registro — para exportar CSV. */
export async function getBetsForExport(userId: string, options: StatsOptions = {}): Promise<Bet[]> {
  const bets = await getUserBets(userId, options);
  return [...bets].sort((a, b) => a.createdAt - b.createdAt);
}

export interface ProfitPoint {
  /** Timestamp de resolución (ganada/perdida) de la apuesta. */
  at: number;
  cumulativeProfit: number;
}

/** Beneficio acumulado apuesta a apuesta, en orden cronológico de resolución — para la gráfica premium. Solo cuenta apuestas ya resueltas. */
export async function getProfitSeries(userId: string, options: StatsOptions = {}): Promise<ProfitPoint[]> {
  const bets = await getUserBets(userId, options);
  const resolved = bets
    .filter((b): b is Bet & { resolvedAt: number } => b.status !== "pendiente" && b.resolvedAt !== undefined)
    .sort((a, b) => a.resolvedAt - b.resolvedAt);

  let cumulative = 0;
  return resolved.map((b) => {
    cumulative = cleanFloat(cumulative + (b.profit ?? 0));
    return { at: b.resolvedAt, cumulativeProfit: cumulative };
  });
}

function toBet(doc: DocumentSnapshot): Bet {
  return { id: doc.id, ...doc.data() } as Bet;
}

/** Corrige el ruido de coma flotante antes de redondear. */
function cleanFloat(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** "45.5" -> "45,5", "46" -> "46" — sin ceros de más, coma decimal. */
export function formatMoney(n: number): string {
  const fixed = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return fixed.replace(".", ",");
}
