import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name} (revisa tu .env)`);
  }
  return value;
}

export const env = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  // Opcional a propósito: en el primer despliegue a Cloud Run todavía no
  // conocemos la URL pública del propio servicio (huevo y gallina). El
  // servidor arranca igualmente y solo registra el webhook si esto está
  // definido (ver server.ts) — se completa en el segundo despliegue.
  publicUrl: process.env.PUBLIC_URL,
  webhookSecretPath: required("WEBHOOK_SECRET_PATH"),
  port: Number(process.env.PORT ?? 8080),
  geminiApiKey: required("GEMINI_API_KEY"),
  // ID numérico de Telegram del dueño del bot: único autorizado a usar
  // /premium_on y /premium_off. Opcional a propósito — si no está definida,
  // esos comandos simplemente no los puede usar nadie, en vez de tumbar el
  // servidor al arrancar.
  ownerTelegramId: process.env.OWNER_TELEGRAM_ID,
  // API key de The Odds API (the-odds-api.com), para el comparador de
  // cuotas. Opcional a propósito — si no está definida, el comparador
  // simplemente no se ejecuta (el registro del ticket sigue funcionando
  // igual).
  oddsApiKey: process.env.ODDS_API_KEY,
  // Cobro automático de Premium (Stripe). Las tres opcionales a propósito:
  // sin ellas, el botón "⭐ Premium" simplemente no ofrece pagar solo y cae
  // al mensaje de activación manual de siempre.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  // Firma para verificar que los webhooks vienen de verdad de Stripe (ver
  // server.ts). Sin ella, el endpoint /webhooks/stripe rechaza todo.
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  // ID del precio recurrente mensual creado en el Dashboard de Stripe.
  stripePriceId: process.env.STRIPE_PRICE_ID,
  // Username del bot (sin @), para volver al chat tras pagar en Stripe
  // Checkout. Opcional: sin él, se usa PUBLIC_URL como destino de vuelta.
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
};
