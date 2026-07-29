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
};
