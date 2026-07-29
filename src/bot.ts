import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import { analyzeTicket, type TicketInfo } from "./tickets/analyzeTicket";
import {
  createPendingBet,
  getBet,
  getPendingBets,
  markBetLost,
  markBetWon,
  getStatsSummary,
  formatMoney,
  type BetInput,
} from "./stats/betsStore";
import { setPendingStake, consumePendingStake, setPendingOdds, consumePendingOdds } from "./state/pendingInput";

// Por defecto Telegraf corta el procesamiento de cada update a los 90s
// (handlerTimeout); leer un ticket con la visión de Gemini puede tardar más
// en algún caso puntual, así que lo desactivamos aquí (analyzeTicket ya
// tiene su propio timeout interno).
export const bot = new Telegraf(env.telegramBotToken, { handlerTimeout: Infinity });

const START_BUTTON_TEXT = "🏠 Empezar";
const PENDIENTES_BUTTON_TEXT = "📝 Pendientes";
const STATS_BUTTON_TEXT = "📊 Stats";
const mainKeyboard = Markup.keyboard([[START_BUTTON_TEXT, PENDIENTES_BUTTON_TEXT, STATS_BUTTON_TEXT]]).resize();

async function sendWelcome(ctx: Context) {
  await ctx.reply(
    "👋 Mándame la foto de tu ticket de apuesta y lo registro automáticamente: deporte, partido, cuota e importe.\n\n" +
      "Cuando se resuelva, márcala como ✅ Ganada o ❌ Perdida desde /pendientes.\n\n" +
      "Consulta tus estadísticas con /stats",
    mainKeyboard
  );
}

bot.start(sendWelcome);
bot.hears(START_BUTTON_TEXT, sendWelcome);

function parseDecimalInput(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function downloadTelegramPhoto(ctx: Context): Promise<Buffer> {
  const message = ctx.message as { photo?: Array<{ file_id: string }> } | undefined;
  const photos = message?.photo;
  if (!photos || photos.length === 0) {
    throw new Error("No se encontró ninguna foto en el mensaje.");
  }
  const fileId = photos[photos.length - 1].file_id; // la de mayor resolución
  const link = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(link.href);
  return Buffer.from(await response.arrayBuffer());
}

function pendingBetKeyboard(betId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Ganada", `betwon:${betId}`), Markup.button.callback("❌ Perdida", `betlost:${betId}`)],
  ]);
}

interface BetDescription {
  sport: string;
  match: string;
  betType: TicketInfo["betType"];
  /** Cuota ya formateada para mostrar (con coma decimal), o null si no se conoce. */
  oddsLabel: string | null;
}

function describeBet(bet: BetDescription, stake: number): string {
  const lines = [
    bet.sport,
    `🎯 ${bet.match}`,
    bet.betType === "combinada" ? "🔀 Combinada" : "🔹 Simple",
    bet.oddsLabel ? `💰 Cuota: ${bet.oddsLabel}` : null,
    `💶 Importe: ${formatMoney(stake)}€`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

async function registerBet(ctx: Context, userId: string, ticket: TicketInfo, stake: number) {
  const input: BetInput = {
    userId,
    sport: ticket.sport,
    match: ticket.match,
    betType: ticket.betType,
    estimatedOdds: ticket.odds ? parseDecimalInput(ticket.odds) : null,
    stake,
  };
  const betId = await createPendingBet(input);

  await ctx.reply(`✅ *Apuesta registrada*\n${describeBet({ ...ticket, oddsLabel: ticket.odds || null }, stake)}`, {
    parse_mode: "Markdown",
    ...pendingBetKeyboard(betId),
  });
}

bot.on("photo", async (ctx) => {
  const userId = String(ctx.from!.id);
  await ctx.reply("📸 Leyendo el ticket...");

  let ticket: TicketInfo;
  try {
    const buffer = await downloadTelegramPhoto(ctx);
    ticket = await analyzeTicket(buffer, env.geminiApiKey);
  } catch (err) {
    console.error("No se pudo leer el ticket:", err);
    await ctx.reply("⚠️ No pude leer el ticket. Prueba con una foto más clara, bien encuadrada y sin recortar los datos.");
    return;
  }

  const stake = ticket.stake ? parseDecimalInput(ticket.stake) : null;
  if (stake === null) {
    await setPendingStake(userId, ticket);
    await ctx.reply("💶 No pude leer el importe apostado en el ticket. ¿Cuánto apostaste? (solo el número, ej. 10)");
    return;
  }

  await registerBet(ctx, userId, ticket, stake);
});

async function showPendingBets(ctx: Context) {
  const userId = String(ctx.from!.id);
  let bets;
  try {
    bets = await getPendingBets(userId);
  } catch (err) {
    console.error("No se pudieron obtener las apuestas pendientes:", err);
    await ctx.reply("⚠️ No se pudieron obtener las apuestas pendientes. Revisa los logs.");
    return;
  }

  if (bets.length === 0) {
    await ctx.reply("No hay apuestas pendientes de resolver.");
    return;
  }

  for (const bet of bets) {
    const oddsLabel = bet.estimatedOdds !== null ? formatMoney(bet.estimatedOdds) : null;
    await ctx.reply(`📌 ${describeBet({ ...bet, oddsLabel }, bet.stake)}`, pendingBetKeyboard(bet.id));
  }
}

bot.command("pendientes", showPendingBets);
bot.hears(PENDIENTES_BUTTON_TEXT, showPendingBets);

bot.action(/^betlost:(.+)$/, async (ctx) => {
  const betId = ctx.match[1];
  try {
    const profit = await markBetLost(betId);
    await ctx.answerCbQuery("Marcada como perdida ❌");
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`❌ Apuesta marcada como perdida (${formatMoney(profit)}€).`);
  } catch (err) {
    console.error("No se pudo marcar la apuesta como perdida:", err);
    await ctx.answerCbQuery("⚠️ No se pudo actualizar. Revisa los logs.", { show_alert: true });
  }
});

// Al marcar "✅ Ganada" usamos directamente la cuota leída del ticket al
// registrar la apuesta (ya es la cuota real a la que jugó el usuario, no
// hace falta volver a preguntarla). Solo si Gemini no pudo leerla del
// ticket le pedimos que la escriba, como último recurso.
bot.action(/^betwon:(.+)$/, async (ctx) => {
  const betId = ctx.match[1];
  const bet = await getBet(betId);
  if (!bet) {
    await ctx.answerCbQuery("⚠️ No se encontró esa apuesta.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);

  if (bet.estimatedOdds === null) {
    await setPendingOdds(String(ctx.from!.id), betId);
    await ctx.reply("✅ Marcada como ganada. No pude leer la cuota en el ticket — mándame la cuota, p.ej. 1,91.");
    return;
  }

  try {
    const profit = await markBetWon(betId, bet.estimatedOdds);
    await ctx.reply(`✅ Apuesta ganada @${formatMoney(bet.estimatedOdds)}. Beneficio: +${formatMoney(profit)}€.`);
  } catch (err) {
    console.error("No se pudo marcar la apuesta como ganada:", err);
    await ctx.reply("⚠️ No se pudo actualizar la apuesta. Revisa los logs.");
  }
});

async function showStats(ctx: Context, filter?: string) {
  const userId = String(ctx.from!.id);
  let summary;
  try {
    summary = await getStatsSummary(userId, filter);
  } catch (err) {
    console.error("No se pudieron obtener las estadísticas:", err);
    await ctx.reply("⚠️ No se pudieron obtener las estadísticas. Revisa los logs.");
    return;
  }

  const resolved = summary.won + summary.lost;
  const lines = [
    filter ? `📊 *Estadísticas* (filtro: ${filter})` : "📊 *Estadísticas*",
    "",
    `Apuestas registradas: ${summary.total}`,
    `Pendientes: ${summary.pending}`,
    `Resueltas: ${resolved} (${summary.won} ganadas, ${summary.lost} perdidas)`,
    resolved > 0 ? `Acierto: ${formatMoney(summary.hitRate)}%` : "Acierto: —",
    `Beneficio neto: ${summary.netProfit >= 0 ? "+" : ""}${formatMoney(summary.netProfit)}€`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

bot.command("stats", (ctx) => {
  const filter = ctx.message.text.split(/\s+/).slice(1).join(" ").trim() || undefined;
  return showStats(ctx, filter);
});
bot.hears(STATS_BUTTON_TEXT, (ctx) => showStats(ctx));

// Manejador genérico de texto: registrado el ÚLTIMO a propósito. Los
// comandos y botones de arriba (bot.command/bot.hears) ya consumen su
// propio texto; si este handler se registra antes que ellos, se come
// CUALQUIER mensaje de texto (incluidos los botones del teclado y los
// comandos) antes de que lleguen a su manejador correspondiente. Aquí solo
// deben llegar los mensajes que responden a una pregunta pendiente
// (importe no leído del ticket, o cuota si no se pudo leer del ticket).
bot.on("text", async (ctx) => {
  const userId = String(ctx.from.id);

  const betIdAwaitingOdds = await consumePendingOdds(userId);
  if (betIdAwaitingOdds !== null) {
    const oddsValue = parseDecimalInput(ctx.message.text);
    if (oddsValue === null || oddsValue <= 1) {
      await setPendingOdds(userId, betIdAwaitingOdds);
      await ctx.reply("⚠️ No entendí esa cuota. Mándame un número mayor que 1, p.ej. 1,91.");
      return;
    }
    try {
      const profit = await markBetWon(betIdAwaitingOdds, oddsValue);
      await ctx.reply(`✅ Apuesta ganada @${ctx.message.text.trim()}. Beneficio: +${formatMoney(profit)}€.`);
    } catch (err) {
      console.error("No se pudo marcar la apuesta como ganada:", err);
      await ctx.reply("⚠️ No se pudo actualizar la apuesta. Revisa los logs.");
    }
    return;
  }

  const pendingTicket = await consumePendingStake(userId);
  if (pendingTicket !== null) {
    const stake = parseDecimalInput(ctx.message.text);
    if (stake === null) {
      await setPendingStake(userId, pendingTicket);
      await ctx.reply("⚠️ No entendí ese importe. Mándame solo el número, p.ej. 10.");
      return;
    }
    await registerBet(ctx, userId, pendingTicket, stake);
  }
});
