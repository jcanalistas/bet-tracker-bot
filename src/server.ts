import express from "express";
import { bot } from "./bot";
import { env } from "./config/env";
import { handleStripeWebhook } from "./payments/stripeWebhook";
import { sendPendingReminders } from "./reminders/pendingReminders";

// Red de seguridad: sin esto, un rechazo de promesa no capturado en
// cualquier dependencia (p.ej. un timeout interno del SDK de Gemini) tumba
// TODO el proceso — incluidas las peticiones de otros usuarios en curso.
// Lo registramos y seguimos vivos en vez de morir.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (proceso sigue vivo):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (proceso sigue vivo):", err);
});

const app = express();

// Va ANTES del express.json() global: Stripe necesita el cuerpo tal cual
// (Buffer sin parsear) para verificar la firma del webhook — si el body ya
// ha pasado por express.json(), la verificación falla siempre.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json());

const webhookPath = `/telegram/${env.webhookSecretPath}`;

app.get("/", (_req, res) => {
  res.status(200).send("Bet Tracker bot activo.");
});

app.use(bot.webhookCallback(webhookPath));

// Lo llama Cloud Scheduler una vez al día. Sin REMINDER_SECRET configurada
// (o si no coincide), responde 404 en vez de revelar que el endpoint existe.
app.post("/internal/check-reminders", async (req, res) => {
  if (!env.reminderSecret || req.query.secret !== env.reminderSecret) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const notified = await sendPendingReminders(bot.telegram);
    res.status(200).send(`ok: ${notified} usuarios avisados`);
  } catch (err) {
    console.error("Error enviando recordatorios de pendientes:", err);
    res.status(500).send("error");
  }
});

async function main() {
  if (env.publicUrl) {
    const webhookUrl = `${env.publicUrl.replace(/\/$/, "")}${webhookPath}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook registrado en: ${webhookUrl}`);
  } else {
    console.warn(
      "PUBLIC_URL no está definida todavía: arrancando sin registrar el webhook de Telegram. " +
        "Añade PUBLIC_URL y vuelve a desplegar en cuanto tengas la URL de este servicio."
    );
  }

  app.listen(env.port, () => {
    console.log(`Servidor escuchando en el puerto ${env.port}`);
  });
}

main().catch((err) => {
  console.error("Error iniciando el servidor:", err);
  process.exit(1);
});
