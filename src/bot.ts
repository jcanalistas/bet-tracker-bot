import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import { BONUS_OFFERS } from "./config/bonuses";
import { analyzeTicket, type TicketInfo } from "./tickets/analyzeTicket";
import {
  createPendingBet,
  getBet,
  getBetsForExport,
  getDetailedStats,
  getPendingBets,
  getProfitSeries,
  markBetLost,
  markBetWon,
  getStatsSummary,
  formatMoney,
  type BetInput,
  type StatsPeriod,
  type StatsSummary,
} from "./stats/betsStore";
import { setPendingStake, consumePendingStake, setPendingOdds, consumePendingOdds } from "./state/pendingInput";
import { isPremium, setPremium } from "./premium/premiumStore";
import { renderProfitChart } from "./charts/profitChart";
import { betsToCsv } from "./export/csvExport";
import { findBetterOdds } from "./odds/matchOdds";
import { generateBettingAnalysis } from "./analysis/aiAnalysis";

// Por defecto Telegraf corta el procesamiento de cada update a los 90s
// (handlerTimeout); leer un ticket con la visión de Gemini puede tardar más
// en algún caso puntual, así que lo desactivamos aquí (analyzeTicket ya
// tiene su propio timeout interno).
export const bot = new Telegraf(env.telegramBotToken, { handlerTimeout: Infinity });

// Sin esto, un error dentro de cualquier handler (p.ej. un callback query
// caducado) se pierde en silencio: Telegraf lo traga y el usuario se queda
// sin respuesta, sin ninguna pista en los logs de por qué.
bot.catch((err, ctx) => {
  console.error(`Error procesando update ${ctx.updateType}:`, err);
});

// answerCbQuery/editMessageReplyMarkup pueden fallar (callback query
// caducado, mensaje ya editado, etc.) — con try/catch normal esos fallos
// abortarían el resto del handler y el usuario se quedaría sin respuesta
// aunque la parte importante (Firestore, etc.) fuera a funcionar bien. Se
// registran y se ignoran para que el resto del handler siga adelante.
async function safeAnswerCbQuery(ctx: Context, text?: string, extra?: { show_alert?: boolean }) {
  try {
    await ctx.answerCbQuery(text, extra);
  } catch (err) {
    console.error("No se pudo responder al callback query (puede haber caducado):", err);
  }
}

async function safeClearKeyboard(ctx: Context) {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (err) {
    console.error("No se pudo actualizar el teclado del mensaje:", err);
  }
}

const START_BUTTON_TEXT = "🏠 Empezar";
const PENDIENTES_BUTTON_TEXT = "📝 Pendientes";
const STATS_BUTTON_TEXT = "📊 Stats";
const BONOS_BUTTON_TEXT = "🎁 Bonos Bienvenida";
const mainKeyboard = Markup.keyboard([
  [START_BUTTON_TEXT, PENDIENTES_BUTTON_TEXT],
  [STATS_BUTTON_TEXT, BONOS_BUTTON_TEXT],
]).resize();

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

function isOwner(ctx: Context): boolean {
  return env.ownerTelegramId !== undefined && String(ctx.from?.id) === env.ownerTelegramId;
}

async function replyPremiumLocked(ctx: Context) {
  await ctx.reply(
    "🔒 *Contenido premium*\nEsta función es solo para usuarios premium. Escribe /premium para más información.",
    { parse_mode: "Markdown" }
  );
}

bot.command("premium", async (ctx) => {
  const userId = String(ctx.from!.id);
  if (await isPremium(userId)) {
    await ctx.reply("⭐ Ya tienes Premium activo. Disfruta de los filtros avanzados en /stats.");
    return;
  }
  await ctx.reply(
    "⭐ *Premium* desbloquea en /stats: análisis detallado por deporte y tipo, análisis con IA, gráfica de evolución del beneficio y exportar tu historial a CSV.\n\n" +
      "Todavía no hay pago automático — escríbeme por Telegram para activarlo.",
    { parse_mode: "Markdown" }
  );
});

// Activación manual mientras no hay pasarela de pago: solo el dueño del
// bot (OWNER_TELEGRAM_ID) puede usar estos dos comandos. Para cualquier
// otro usuario no hacen nada — ni siquiera revelan que existen.
bot.command("premium_on", async (ctx) => {
  if (!isOwner(ctx)) return;
  const targetId = ctx.message.text.split(/\s+/)[1];
  if (!targetId) {
    await ctx.reply("Uso: /premium_on <ID de Telegram>");
    return;
  }
  await setPremium(targetId, true);
  await ctx.reply(`✅ Premium activado para ${targetId}.`);
});

bot.command("premium_off", async (ctx) => {
  if (!isOwner(ctx)) return;
  const targetId = ctx.message.text.split(/\s+/)[1];
  if (!targetId) {
    await ctx.reply("Uso: /premium_off <ID de Telegram>");
    return;
  }
  await setPremium(targetId, false);
  await ctx.reply(`✅ Premium desactivado para ${targetId}.`);
});

// MarkdownV2 (a diferencia del modo "Markdown" clásico usado en el resto
// del bot) sí soporta anidar negrita + enlace en una misma entidad, que es
// lo que hace falta para que el nombre de la casa sea un hipervínculo en
// negrita. A cambio, hay que escapar los caracteres especiales a mano.
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function escapeMarkdownV2Url(url: string): string {
  return url.replace(/[)\\]/g, "\\$&");
}

async function showBonuses(ctx: Context) {
  if (BONUS_OFFERS.length === 0) {
    await ctx.reply("🎁 Todavía no hay bonos configurados. ¡Vuelve pronto!");
    return;
  }

  const lines = ["🎁 *Bonos de bienvenida*", ""];
  for (const offer of BONUS_OFFERS) {
    const name = escapeMarkdownV2(offer.name);
    const url = escapeMarkdownV2Url(offer.url);
    const bonus = offer.bonus ? escapeMarkdownV2(offer.bonus) : null;
    lines.push(`*[${name}](${url})*${bonus ? ` — ${bonus}` : ""}`);
    lines.push("");
  }

  await ctx.reply(lines.join("\n").trim(), {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  });
}

bot.command("bonos", showBonuses);
bot.hears(BONOS_BUTTON_TEXT, showBonuses);

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

// Comparador de cuotas: se llama DESPUÉS de mandar la confirmación de
// registro (mensaje aparte, nunca bloquea ni retrasa el registro en sí).
// Solo compara fútbol/tenis, apuestas simples y cuando el partido se
// identifica sin ambigüedad — ver findBetterOdds para el detalle del
// alcance. Si no hay nada mejor (o no se puede comparar), no manda nada.
async function maybeSendBetterOdds(ctx: Context, ticket: TicketInfo, currentOdds: number) {
  let offers;
  try {
    offers = await findBetterOdds({
      sport: ticket.sport,
      betType: ticket.betType,
      matchText: ticket.match,
      currentOdds,
      apiKey: env.oddsApiKey,
    });
  } catch (err) {
    console.error("Error comparando cuotas:", err);
    return;
  }

  if (offers.length === 0) return;

  const lines = ["💰 *Mejor cuota disponible*", ""];
  for (const offer of offers.slice(0, 3)) {
    const name = escapeMarkdownV2(offer.house.name);
    const url = escapeMarkdownV2Url(offer.house.url);
    const oddsLabel = escapeMarkdownV2(formatMoney(offer.odds));
    lines.push(`Tienes esta apuesta a @${oddsLabel} en *[${name}](${url})*`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } });
}

async function registerBet(ctx: Context, userId: string, ticket: TicketInfo, stake: number) {
  const estimatedOdds = ticket.odds ? parseDecimalInput(ticket.odds) : null;
  const input: BetInput = {
    userId,
    sport: ticket.sport,
    match: ticket.match,
    betType: ticket.betType,
    estimatedOdds,
    stake,
  };
  const betId = await createPendingBet(input);

  await ctx.reply(`✅ *Apuesta registrada*\n${describeBet({ ...ticket, oddsLabel: ticket.odds || null }, stake)}`, {
    parse_mode: "Markdown",
    ...pendingBetKeyboard(betId),
  });

  if (estimatedOdds !== null) {
    await maybeSendBetterOdds(ctx, ticket, estimatedOdds);
  }
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
    await safeAnswerCbQuery(ctx, "Marcada como perdida ❌");
    await safeClearKeyboard(ctx);
    await ctx.reply(`❌ Apuesta marcada como perdida (${formatMoney(profit)}€).`);
  } catch (err) {
    console.error("No se pudo marcar la apuesta como perdida:", err);
    await safeAnswerCbQuery(ctx, "⚠️ No se pudo actualizar. Revisa los logs.", { show_alert: true });
  }
});

// Al marcar "✅ Ganada" usamos directamente la cuota leída del ticket al
// registrar la apuesta (ya es la cuota real a la que jugó el usuario, no
// hace falta volver a preguntarla). Solo si Gemini no pudo leerla del
// ticket le pedimos que la escriba, como último recurso.
bot.action(/^betwon:(.+)$/, async (ctx) => {
  const betId = ctx.match[1];
  let bet;
  try {
    bet = await getBet(betId);
  } catch (err) {
    console.error("No se pudo leer la apuesta:", err);
    await safeAnswerCbQuery(ctx, "⚠️ No se pudo leer la apuesta. Revisa los logs.", { show_alert: true });
    return;
  }
  if (!bet) {
    await safeAnswerCbQuery(ctx, "⚠️ No se encontró esa apuesta.", { show_alert: true });
    return;
  }

  await safeAnswerCbQuery(ctx);
  await safeClearKeyboard(ctx);

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

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  mes: "Mes actual",
  anio: "Año actual",
  historico: "Histórico",
};

function periodKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📅 Mes actual", "stats:mes")],
    [Markup.button.callback("🗓️ Año actual", "stats:anio")],
    [Markup.button.callback("📚 Histórico", "stats:historico")],
  ]);
}

async function askStatsPeriod(ctx: Context) {
  await ctx.reply("📊 ¿Qué periodo quieres consultar?", periodKeyboard());
}

// Filtros y extras avanzados: solo premium.
function statsFilterKeyboard(period: StatsPeriod) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⭐ Análisis detallado", `statsf:${period}:detallado`)],
    [Markup.button.callback("⭐ Análisis IA", `statsf:${period}:ia`)],
    [
      Markup.button.callback("⭐ Gráfica", `statsf:${period}:grafica`),
      Markup.button.callback("⭐ Exportar CSV", `statsf:${period}:csv`),
    ],
  ]);
}

async function showStats(ctx: Context, period: StatsPeriod, filter?: string) {
  const userId = String(ctx.from!.id);
  let summary;
  try {
    summary = await getStatsSummary(userId, { filter, period });
  } catch (err) {
    console.error("No se pudieron obtener las estadísticas:", err);
    await ctx.reply("⚠️ No se pudieron obtener las estadísticas. Revisa los logs.");
    return;
  }

  const resolved = summary.won + summary.lost;
  const profitIcon = summary.netProfit > 0 ? "📈" : summary.netProfit < 0 ? "📉" : "➖";
  const header = `📊 *Estadísticas* — ${PERIOD_LABELS[period]}${filter ? ` (filtro: ${filter})` : ""}`;
  const lines = [
    header,
    "",
    `📝 Registradas: ${summary.total}`,
    `⏳ Pendientes: ${summary.pending}`,
    `📌 Resueltas: ${resolved} (✅ ${summary.won} · ❌ ${summary.lost})`,
    resolved > 0 ? `🎯 Acierto: ${formatMoney(summary.hitRate)}%` : "🎯 Acierto: —",
    `${profitIcon} Beneficio: ${summary.netProfit >= 0 ? "+" : ""}${formatMoney(summary.netProfit)}€`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", ...statsFilterKeyboard(period) });
}

bot.command("stats", async (ctx) => {
  const filter = ctx.message.text.split(/\s+/).slice(1).join(" ").trim() || undefined;
  if (filter) {
    if (!(await isPremium(String(ctx.from.id)))) {
      await replyPremiumLocked(ctx);
      return;
    }
    await showStats(ctx, "historico", filter);
    return;
  }
  await askStatsPeriod(ctx);
});
bot.hears(STATS_BUTTON_TEXT, askStatsPeriod);

bot.action(/^stats:(mes|anio|historico)$/, async (ctx) => {
  const period = ctx.match[1] as StatsPeriod;
  await safeAnswerCbQuery(ctx);
  await safeClearKeyboard(ctx);
  await showStats(ctx, period);
});

function formatSummaryLine(label: string, summary: StatsSummary): string {
  const resolved = summary.won + summary.lost;
  const profitIcon = summary.netProfit > 0 ? "📈" : summary.netProfit < 0 ? "📉" : "➖";
  const hitRateLabel = resolved > 0 ? `${formatMoney(summary.hitRate)}%` : "—";
  return `*${label}*: ${summary.total} · 🎯 ${hitRateLabel} · ${profitIcon} ${summary.netProfit >= 0 ? "+" : ""}${formatMoney(summary.netProfit)}€`;
}

bot.action(/^statsf:(mes|anio|historico):detallado$/, async (ctx) => {
  const period = ctx.match[1] as StatsPeriod;
  const userId = String(ctx.from!.id);
  await safeAnswerCbQuery(ctx);
  if (!(await isPremium(userId))) {
    await replyPremiumLocked(ctx);
    return;
  }

  let detailed;
  try {
    detailed = await getDetailedStats(userId, period);
  } catch (err) {
    console.error("No se pudo obtener el análisis detallado:", err);
    await ctx.reply("⚠️ No se pudo obtener el análisis detallado. Revisa los logs.");
    return;
  }

  const lines = [`🔎 *Análisis detallado* — ${PERIOD_LABELS[period]}`, "", "*Por tipo*"];
  lines.push(formatSummaryLine("Simple", detailed.simple));
  lines.push(formatSummaryLine("Combinada", detailed.combinada));
  lines.push("", "*Por deporte*");
  if (detailed.bySport.length === 0) {
    lines.push("_Sin apuestas en este periodo._");
  } else {
    for (const { sport, summary } of detailed.bySport) {
      lines.push(formatSummaryLine(sport, summary));
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.action(/^statsf:(mes|anio|historico):ia$/, async (ctx) => {
  const period = ctx.match[1] as StatsPeriod;
  const userId = String(ctx.from!.id);
  await safeAnswerCbQuery(ctx);
  if (!(await isPremium(userId))) {
    await replyPremiumLocked(ctx);
    return;
  }

  let detailed;
  try {
    detailed = await getDetailedStats(userId, period);
  } catch (err) {
    console.error("No se pudo obtener los datos para el análisis IA:", err);
    await ctx.reply("⚠️ No se pudo generar el análisis. Revisa los logs.");
    return;
  }

  if (detailed.bySport.length === 0) {
    await ctx.reply("No hay apuestas en este periodo para analizar.");
    return;
  }

  await ctx.reply("🤖 Generando análisis...");
  try {
    const analysis = await generateBettingAnalysis(detailed, env.geminiApiKey);
    await ctx.reply(`🤖 Análisis IA — ${PERIOD_LABELS[period]}\n\n${analysis}`);
  } catch (err) {
    console.error("No se pudo generar el análisis IA:", err);
    await ctx.reply("⚠️ No se pudo generar el análisis. Inténtalo de nuevo en un momento.");
  }
});

bot.action(/^statsf:(mes|anio|historico):grafica$/, async (ctx) => {
  const period = ctx.match[1] as StatsPeriod;
  const userId = String(ctx.from!.id);
  await safeAnswerCbQuery(ctx);
  if (!(await isPremium(userId))) {
    await replyPremiumLocked(ctx);
    return;
  }

  let points;
  try {
    points = await getProfitSeries(userId, { period });
  } catch (err) {
    console.error("No se pudo generar la gráfica:", err);
    await ctx.reply("⚠️ No se pudo generar la gráfica. Revisa los logs.");
    return;
  }

  if (points.length < 2) {
    await ctx.reply("📈 Todavía no hay suficientes apuestas resueltas en este periodo para dibujar una gráfica.");
    return;
  }

  const chart = await renderProfitChart(points);
  await ctx.replyWithPhoto({ source: chart }, { caption: `📈 Evolución del beneficio — ${PERIOD_LABELS[period]}` });
});

bot.action(/^statsf:(mes|anio|historico):csv$/, async (ctx) => {
  const period = ctx.match[1] as StatsPeriod;
  const userId = String(ctx.from!.id);
  await safeAnswerCbQuery(ctx);
  if (!(await isPremium(userId))) {
    await replyPremiumLocked(ctx);
    return;
  }

  let bets;
  try {
    bets = await getBetsForExport(userId, { period });
  } catch (err) {
    console.error("No se pudo exportar el historial:", err);
    await ctx.reply("⚠️ No se pudo exportar el historial. Revisa los logs.");
    return;
  }

  if (bets.length === 0) {
    await ctx.reply("No hay apuestas en este periodo para exportar.");
    return;
  }

  // BOM al principio para que Excel detecte UTF-8 y no rompa los acentos.
  const csv = "\uFEFF" + betsToCsv(bets);
  await ctx.replyWithDocument({ source: Buffer.from(csv, "utf-8"), filename: `historial-apuestas-${period}.csv` });
});

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
