import { Firestore } from "@google-cloud/firestore";

// En Cloud Run se autentica solo vía Application Default Credentials (la
// cuenta de servicio adjunta al propio servicio), sin ningún secreto nuevo
// que gestionar. En local hace falta `gcloud auth application-default login`.
export const firestore = new Firestore();
