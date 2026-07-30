import type { Telegram } from "telegraf";
import { getStalePendingBets } from "../stats/betsStore";

const DAY_MS = 24 * 60 * 60 * 1000;
// Menos de esto no molesta al usuario — le da tiempo de sobra a que el
// partido termine antes de pedirle que resuelva la apuesta.
const MIN_AGE_MS = DAY_MS;

/**
 * Avisa por Telegram a cada usuario con apuestas pendientes desde hace un
 * día o más, para que no se le olvide resolverlas y sus stats no queden
 * incompletas. Pensado para llamarse una vez al día desde Cloud Scheduler
 * (ver /internal/check-reminders en server.ts). Devuelve cuántos usuarios
 * fueron avisados.
 */
export async function sendPendingReminders(telegram: Telegram): Promise<number> {
  const staleBets = await getStalePendingBets(MIN_AGE_MS);
  if (staleBets.length === 0) return 0;

  const byUser = new Map<string, number>();
  for (const bet of staleBets) {
    byUser.set(bet.userId, (byUser.get(bet.userId) ?? 0) + 1);
  }

  let notified = 0;
  for (const [userId, count] of byUser) {
    const text =
      count === 1
        ? "⏳ Tienes 1 apuesta pendiente desde hace más de un día. Márcala en /pendientes para que tus stats no queden incompletas."
        : `⏳ Tienes ${count} apuestas pendientes desde hace más de un día. Márcalas en /pendientes para que tus stats no queden incompletas.`;
    try {
      await telegram.sendMessage(userId, text);
      notified++;
    } catch (err) {
      console.error(`No se pudo avisar de pendientes al usuario ${userId}:`, err);
    }
  }
  return notified;
}
