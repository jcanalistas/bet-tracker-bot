import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripeClient } from "./stripeClient";
import { env } from "../config/env";
import { setPremium, linkStripeCustomer, findUserByStripeCustomerId } from "../premium/premiumStore";

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/** Revoca el premium del usuario de Telegram vinculado a este cliente de Stripe (cancelación o impago). */
async function revokePremiumByCustomer(customerId: string | null): Promise<void> {
  if (!customerId) return;
  const userId = await findUserByStripeCustomerId(customerId);
  if (userId) await setPremium(userId, false);
}

/**
 * Requiere el cuerpo SIN PARSEAR (Buffer) para verificar la firma — se
 * registra con express.raw() antes del express.json() global (ver
 * server.ts). El path no lleva secreto en la URL como el de Telegram
 * porque aquí la autenticidad la garantiza la firma, no la URL.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe || !env.stripeWebhookSecret) {
    res.status(503).send("Stripe no configurado");
    return;
  }

  const signature = req.headers["stripe-signature"];
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature as string, env.stripeWebhookSecret);
  } catch (err) {
    console.error("Firma de webhook de Stripe inválida:", err);
    res.status(400).send("Firma inválida");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = customerIdOf(session.customer);
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
        if (userId && customerId && subscriptionId) {
          await linkStripeCustomer(userId, customerId, subscriptionId);
          await setPremium(userId, true);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await revokePremiumByCustomer(customerIdOf(subscription.customer));
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await revokePremiumByCustomer(customerIdOf(invoice.customer));
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`Error procesando webhook de Stripe (${event.type}):`, err);
  }

  res.status(200).send("ok");
}
