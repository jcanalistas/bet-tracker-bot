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

/** Pendientes de TODOS los usuarios registradas hace más de `minAgeMs` — para el recordatorio diario, no filtra por userId a propósito. */
export async function getStalePendingBets(minAgeMs: number): Promise<Bet[]> {
  const cutoff = Date.now() - minAgeMs;
  const snapshot = await firestore.collection(COLLECTION).where("status", "==", "pendiente").get();
  return snapshot.docs.map(toBet).filter((b) => b.createdAt <= cutoff);
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
  /** Importe apostado en juego real (excluye nulas, que se devuelven sin riesgo). Base para el yield/ROI. */
  totalStaked: number;
  /** Yield o ROI: beneficio ÷ importe arriesgado, en %. Es la métrica que de verdad mide si una estrategia funciona, más allá del € neto. */
  roi: number;
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

  // Solo cuenta lo que estuvo de verdad en riesgo: nula devuelve el importe
  // íntegro (no hubo apuesta real) y pendiente aún no ha jugado su suerte.
  const staked = bets.filter((b) => b.status === "ganada" || b.status === "perdida" || b.status === "cashout");
  const totalStaked = cleanFloat(staked.reduce((sum, b) => sum + b.stake, 0));
  const roi = totalStaked > 0 ? cleanFloat((netProfit / totalStaked) * 100) : 0;

  return { total: bets.length, pending, won, lost, hitRate, netProfit, totalStaked, roi };
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

export interface StakeSizeStats {
  label: string;
  total: number;
  won: number;
  lost: number;
  hitRate: number;
  netProfit: number;
}

export interface StreakInfo {
  /** null si no hay ninguna apuesta resuelta todavía. */
  type: "ganada" | "perdida" | null;
  count: number;
}

export interface DetailedStats {
  bySport: { sport: string; summary: StatsSummary }[];
  simple: StatsSummary;
  combinada: StatsSummary;
  /** Desglose por rango de cuota (solo resueltas), para ver en qué franja se acierta más — usado por el Análisis IA. */
  byOddsRange: OddsRangeStats[];
  /** Apuestas por debajo/encima del importe medio del usuario, para ver si el tamaño de la apuesta afecta al acierto. */
  byStakeSize: StakeSizeStats[];
  /** Racha actual de resultados seguidos (ganadas o perdidas), la más reciente primero. */
  streak: StreakInfo;
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

/** Resueltas de verdad, con un resultado claro (ganada/perdida/cashout) — nula y pendiente quedan fuera de rachas, rangos de cuota, etc. */
function isResolved(bet: Bet): boolean {
  return bet.status === "ganada" || bet.status === "perdida" || bet.status === "cashout";
}

function isWin(bet: Bet): boolean {
  return bet.status === "ganada" || (bet.status === "cashout" && (bet.profit ?? 0) > 0);
}

function summarizeOddsRanges(bets: Bet[]): OddsRangeStats[] {
  const resolved = bets.filter(isResolved);

  return ODDS_RANGES.map(({ label, min, max }) => {
    const inRange = resolved.filter((b) => {
      const odds = oddsOf(b);
      return odds !== null && odds >= min && odds < max;
    });
    const won = inRange.filter(isWin).length;
    const lost = inRange.length - won;
    const netProfit = cleanFloat(inRange.reduce((sum, b) => sum + (b.profit ?? 0), 0));
    const hitRate = inRange.length > 0 ? cleanFloat((won / inRange.length) * 100) : 0;
    return { range: label, total: inRange.length, won, lost, hitRate, netProfit };
  }).filter((r) => r.total > 0);
}

function summarizeByStakeSize(bets: Bet[]): StakeSizeStats[] {
  const resolved = bets.filter(isResolved);
  if (resolved.length === 0) return [];

  const avgStake = cleanFloat(resolved.reduce((sum, b) => sum + b.stake, 0) / resolved.length);
  const buckets: { label: string; filter: (b: Bet) => boolean }[] = [
    { label: `Importe ≤ media (${formatMoney(avgStake)}€)`, filter: (b) => b.stake <= avgStake },
    { label: `Importe > media (${formatMoney(avgStake)}€)`, filter: (b) => b.stake > avgStake },
  ];

  return buckets
    .map(({ label, filter }) => {
      const inBucket = resolved.filter(filter);
      const won = inBucket.filter(isWin).length;
      const lost = inBucket.length - won;
      const netProfit = cleanFloat(inBucket.reduce((sum, b) => sum + (b.profit ?? 0), 0));
      const hitRate = inBucket.length > 0 ? cleanFloat((won / inBucket.length) * 100) : 0;
      return { label, total: inBucket.length, won, lost, hitRate, netProfit };
    })
    .filter((b) => b.total > 0);
}

function computeStreak(bets: Bet[]): StreakInfo {
  const resolved = bets
    .filter((b): b is Bet & { resolvedAt: number } => isResolved(b) && b.resolvedAt !== undefined)
    .sort((a, b) => b.resolvedAt - a.resolvedAt); // más reciente primero

  if (resolved.length === 0) return { type: null, count: 0 };

  const latestIsWin = isWin(resolved[0]);
  let count = 0;
  for (const bet of resolved) {
    if (isWin(bet) !== latestIsWin) break;
    count++;
  }
  return { type: latestIsWin ? "ganada" : "perdida", count };
}

/** Desglose por deporte, tipo, rango de cuota, tamaño de apuesta y racha actual en un único viaje a Firestore, para "⭐ Stats completas" y "⭐ Análisis IA". */
export async function getDetailedStats(userId: string, period: StatsPeriod): Promise<DetailedStats> {
  const bets = await getUserBets(userId, { period });

  const sports = [...new Set(bets.map((b) => b.sport))].sort((a, b) => a.localeCompare(b));
  const bySport = sports.map((sport) => ({ sport, summary: summarize(bets.filter((b) => b.sport === sport)) }));

  return {
    bySport,
    simple: summarize(bets.filter((b) => b.betType === "simple")),
    combinada: summarize(bets.filter((b) => b.betType === "combinada")),
    byOddsRange: summarizeOddsRanges(bets),
    byStakeSize: summarizeByStakeSize(bets),
    streak: computeStreak(bets),
  };
}

/** Todas las apuestas del usuario que cumplen el filtro/periodo, en orden cronológico de registro — para exportar CSV. */
export async function getBetsForExport(userId: string, options: StatsOptions = {}): Promise<Bet[]> {
  const bets = await getUserBets(userId, options);
  return [...bets].sort((a, b) => a.createdAt - b.createdAt);
}

export interface ProfitTimelinePoint {
  /** Etiqueta del eje X: días del mes, semana del año, o mes, según el periodo. */
  label: string;
  cumulativeProfit: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function startOfMonth(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Franjas [inicio, fin) del eje X según el periodo: cada 2 días en "mes", cada semana en "año", cada mes en "histórico". Recorta el final a "ahora" — no tiene sentido dibujar franjas futuras vacías. */
function buildBucketBounds(period: StatsPeriod, earliestResolvedAt: number): number[] {
  const now = Date.now();

  if (period === "mes" || period === "anio") {
    const range = periodRange(period)!;
    const stepMs = period === "mes" ? 2 * DAY_MS : 7 * DAY_MS;
    const limit = Math.min(range.to, now);
    const bounds: number[] = [];
    let t = range.from;
    while (t < limit) {
      bounds.push(t);
      t += stepMs;
    }
    bounds.push(t); // cierra el último tramo
    return bounds;
  }

  // histórico: un tramo por mes natural, desde el mes de la primera apuesta resuelta hasta el actual.
  const bounds: number[] = [];
  let cursor = startOfMonth(earliestResolvedAt);
  const last = startOfMonth(now);
  while (cursor.getTime() <= last.getTime()) {
    bounds.push(cursor.getTime());
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  bounds.push(cursor.getTime());
  return bounds;
}

function bucketLabel(period: StatsPeriod, bucketStart: number): string {
  const d = new Date(bucketStart);
  if (period === "mes") return `${d.getDate()}`;
  if (period === "anio") return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${MONTH_LABELS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/**
 * Beneficio acumulado agrupado por franjas de tiempo (no una por apuesta):
 * cada 2 días si el periodo es "mes", cada semana si es "año", cada mes si
 * es "histórico" — para que la gráfica premium sea legible aunque haya
 * muchas apuestas. Solo cuenta apuestas ya resueltas (ganada/perdida/
 * cashout; nula no suma ni resta pero tampoco hace falta excluirla del
 * cálculo porque su beneficio ya es 0).
 */
export async function getProfitTimeline(userId: string, period: StatsPeriod): Promise<ProfitTimelinePoint[]> {
  const bets = await getUserBets(userId, { period });
  const resolved = bets
    .filter((b): b is Bet & { resolvedAt: number } => isResolved(b) && b.resolvedAt !== undefined)
    .sort((a, b) => a.resolvedAt - b.resolvedAt);

  if (resolved.length === 0) return [];

  const bounds = buildBucketBounds(period, resolved[0].resolvedAt);
  if (bounds.length < 2) return [];

  let cumulative = 0;
  let betIndex = 0;
  const points: ProfitTimelinePoint[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const bucketEnd = bounds[i + 1];
    while (betIndex < resolved.length && resolved[betIndex].resolvedAt < bucketEnd) {
      cumulative = cleanFloat(cumulative + (resolved[betIndex].profit ?? 0));
      betIndex++;
    }
    points.push({ label: bucketLabel(period, bounds[i]), cumulativeProfit: cumulative });
  }

  return points;
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
