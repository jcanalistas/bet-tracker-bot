import { firestore } from "../stats/firestore";
import type { TicketInfo } from "../tickets/analyzeTicket";

// Estado a la espera de que el usuario responda algo más tarde (importe no
// leído del ticket, cuota real al marcar Ganada). Lección aprendida en
// JC-Analistas: Cloud Run recicla el contenedor por inactividad en minutos,
// así que cualquier estado en un Map en memoria del proceso Node se pierde
// silenciosamente entre el mensaje del bot y la respuesta del usuario.
// Guardarlo en Firestore (doc ID = el ID de Telegram del usuario) hace que
// sobreviva a cualquier reinicio del contenedor.

const STAKE_COLLECTION = "pendingStakeInput";
const ODDS_COLLECTION = "pendingOddsInput";
const CASHOUT_COLLECTION = "pendingCashoutInput";

/** Ticket ya leído a la espera de que el usuario escriba el importe apostado (el ticket no lo mostraba con claridad). */
export async function setPendingStake(userId: string, ticket: TicketInfo): Promise<void> {
  await firestore.collection(STAKE_COLLECTION).doc(userId).set({ ticket, createdAt: Date.now() });
}

/** Lee y borra en el mismo paso. Null si no había ninguno pendiente. */
export async function consumePendingStake(userId: string): Promise<TicketInfo | null> {
  const ref = firestore.collection(STAKE_COLLECTION).doc(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.delete();
  return (snapshot.data() as { ticket: TicketInfo }).ticket;
}

/** Apuesta marcada "✅ Ganada" a la espera de que el usuario escriba la cuota real conseguida. */
export async function setPendingOdds(userId: string, betId: string): Promise<void> {
  await firestore.collection(ODDS_COLLECTION).doc(userId).set({ betId, createdAt: Date.now() });
}

/** Lee y borra en el mismo paso. Null si no había ninguna pendiente. */
export async function consumePendingOdds(userId: string): Promise<string | null> {
  const ref = firestore.collection(ODDS_COLLECTION).doc(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.delete();
  return (snapshot.data() as { betId: string }).betId;
}

/** Apuesta marcada "💵 Cashout" a la espera de que el usuario escriba el beneficio (puede ser negativo). */
export async function setPendingCashout(userId: string, betId: string): Promise<void> {
  await firestore.collection(CASHOUT_COLLECTION).doc(userId).set({ betId, createdAt: Date.now() });
}

/** Lee y borra en el mismo paso. Null si no había ninguno pendiente. */
export async function consumePendingCashout(userId: string): Promise<string | null> {
  const ref = firestore.collection(CASHOUT_COLLECTION).doc(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.delete();
  return (snapshot.data() as { betId: string }).betId;
}
