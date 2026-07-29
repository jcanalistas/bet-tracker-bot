import type { DocumentSnapshot } from "@google-cloud/firestore";
import { firestore } from "./firestore";
import type { BetType } from "../tickets/analyzeTicket";

export type BetStatus = "pendiente" | "ganada" | "perdida";

export interface BetInput {
  /** ID de usuario de Telegram, como string. Aísla los datos de cada usuario. */
  userId: string;
  sport: string;
  competition: string;
  selections: string;
  betType: BetType;
  /** Cuota leída del ticket al registrar, informativa (la que cuenta para el beneficio es la real, tecleada al marcar Ganada). */
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

export interface StatsSummary {
  total: number;
  pending: number;
  won: number;
  lost: number;
  hitRate: number; // % sobre las resueltas (ganadas + perdidas)
  netProfit: number;
}

/** `filter`: "simple" / "combinada" filtran por tipo; cualquier otro texto filtra por deporte (coincidencia parcial, sin distinguir mayúsculas). */
export async function getStatsSummary(userId: string, filter?: string): Promise<StatsSummary> {
  const snapshot = await firestore.collection(COLLECTION).where("userId", "==", userId).get();
  let bets = snapshot.docs.map(toBet);

  if (filter) {
    const normalized = filter.trim().toLowerCase();
    if (normalized === "simple" || normalized === "combinada") {
      bets = bets.filter((b) => b.betType === normalized);
    } else {
      bets = bets.filter((b) => b.sport.toLowerCase().includes(normalized));
    }
  }

  const pending = bets.filter((b) => b.status === "pendiente").length;
  const won = bets.filter((b) => b.status === "ganada").length;
  const lost = bets.filter((b) => b.status === "perdida").length;
  const resolved = won + lost;
  const netProfit = cleanFloat(bets.reduce((sum, b) => sum + (b.profit ?? 0), 0));
  const hitRate = resolved > 0 ? cleanFloat((won / resolved) * 100) : 0;

  return { total: bets.length, pending, won, lost, hitRate, netProfit };
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
