import { firestore } from "../stats/firestore";

const COLLECTION = "users";

export async function isPremium(userId: string): Promise<boolean> {
  const snapshot = await firestore.collection(COLLECTION).doc(userId).get();
  if (!snapshot.exists) return false;
  return Boolean(snapshot.data()?.premium);
}

export async function setPremium(userId: string, premium: boolean): Promise<void> {
  await firestore.collection(COLLECTION).doc(userId).set({ premium, updatedAt: Date.now() }, { merge: true });
}

/** Asocia el ID de Telegram con su cliente/suscripción de Stripe, para poder revocar el premium cuando cancele o falle el pago. */
export async function linkStripeCustomer(userId: string, customerId: string, subscriptionId: string): Promise<void> {
  await firestore
    .collection(COLLECTION)
    .doc(userId)
    .set({ stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId }, { merge: true });
}

/** Busca qué usuario de Telegram corresponde a un cliente de Stripe (para los webhooks de cancelación/impago). Null si no hay ninguno vinculado. */
export async function findUserByStripeCustomerId(customerId: string): Promise<string | null> {
  const snapshot = await firestore.collection(COLLECTION).where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}
