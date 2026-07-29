import Stripe from "stripe";
import { env } from "../config/env";

let client: Stripe | null = null;

/** Null si STRIPE_SECRET_KEY no está configurada — el cobro automático simplemente no se ofrece. */
export function getStripeClient(): Stripe | null {
  if (!env.stripeSecretKey) return null;
  if (!client) client = new Stripe(env.stripeSecretKey);
  return client;
}

/** Sesión de Checkout para la suscripción mensual, con el ID de Telegram como client_reference_id (así el webhook sabe a quién activarle el premium). */
export async function createSubscriptionCheckout(telegramUserId: string): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe || !env.stripePriceId) return null;

  const returnUrl = env.telegramBotUsername
    ? `https://t.me/${env.telegramBotUsername}`
    : env.publicUrl ?? "https://t.me";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: env.stripePriceId, quantity: 1 }],
    client_reference_id: telegramUserId,
    success_url: returnUrl,
    cancel_url: returnUrl,
  });

  return session.url;
}
