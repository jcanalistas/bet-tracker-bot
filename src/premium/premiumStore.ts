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
