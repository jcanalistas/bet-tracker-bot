# Bet Tracker Bot — Bot de Telegram

Réplica en Telegram de una app de registro/estadísticas de apuestas (tipo
Metrika): cero fricción de instalar nada, vive donde ya está el apostador.

1. Mandas la foto del ticket de tu apuesta.
2. El bot la lee (visión de Gemini) y la registra automáticamente:
   deporte, partido (equipos/jugadores + selección), tipo (simple/combinada),
   cuota e importe.
3. Más tarde la marcas como ✅ Ganada o ❌ Perdida con un botón — el
   beneficio se calcula solo, con la cuota que ya se leyó del ticket (no
   hace falta volver a escribirla).
4. `/stats` — aciertos, beneficio, con filtros por deporte y por
   simple/combinada.

Multi-usuario desde el primer día: cada persona que hable con el bot tiene
sus propias apuestas y estadísticas, aisladas por su ID de Telegram.

Este proyecto es independiente de JC Analistas (bot de picks/análisis):
comparte piezas técnicas de base (lectura de tickets por visión, patrón de
botones persistidos en Firestore, cliente de Firestore vía ADC) pero no
tiene ninguna otra relación — no analiza ni recomienda apuestas, solo las
trackea.

## Requisitos

- Node.js 20+
- Una API key de Gemini (gratis, Google AI Studio)
- Un bot de Telegram

## 1. Crear el bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram.
2. Envía `/newbot` y sigue las instrucciones (nombre y username del bot).
3. Guarda el **token** que te da — es tu `TELEGRAM_BOT_TOKEN`.

A diferencia de JC Analistas, este bot es multi-usuario: no hace falta
restringirlo a un único ID de Telegram.

## 2. Conseguir la API key de Gemini

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Inicia sesión con tu Google y pulsa "Create API key".
3. Guarda esa key — es tu `GEMINI_API_KEY`.

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Rellena `TELEGRAM_BOT_TOKEN` y `GEMINI_API_KEY`. El resto (`PUBLIC_URL`,
`WEBHOOK_SECRET_PATH`) se completan al desplegar (paso 5).

## 4. Instalar dependencias

```bash
npm install
```

## 5. Desplegar en Cloud Run

### 5.1 Subir los secretos (token del bot y API key de Gemini)

Se guardan en Secret Manager en vez de como variables de entorno planas,
para que no queden visibles en la consola de Cloud Run:

```bash
echo -n "TU_TOKEN_DE_TELEGRAM" | gcloud secrets create telegram-bot-token --data-file=-
echo -n "TU_API_KEY_DE_GEMINI" | gcloud secrets create gemini-api-key --data-file=-
```

Si alguna vez regeneras alguna de las dos, sube una nueva versión:

```bash
echo -n "NUEVO_VALOR" | gcloud secrets versions add telegram-bot-token --data-file=-
echo -n "NUEVO_VALOR" | gcloud secrets versions add gemini-api-key --data-file=-
```

### 5.2 Construir y desplegar (primera vez)

```bash
gcloud run deploy bet-tracker-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars WEBHOOK_SECRET_PATH=UNA_CADENA_ALEATORIA \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,GEMINI_API_KEY=gemini-api-key:latest \
  --timeout=300
```

Al terminar, `gcloud` imprime la URL pública del servicio (algo como
`https://bet-tracker-bot-xxxxx.a.run.app`). Cópiala para el siguiente paso.

### 5.3 Segundo despliegue: añadir PUBLIC_URL

El servicio necesita conocer su propia URL pública para registrar el
webhook de Telegram al arrancar:

```bash
gcloud run services update bet-tracker-bot \
  --region europe-southwest1 \
  --update-env-vars PUBLIC_URL=https://TU-URL-DE-CLOUD-RUN.a.run.app
```

### 5.4 Verificar el webhook

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Debe apuntar a `https://<tu-servicio>.a.run.app/telegram/<WEBHOOK_SECRET_PATH>`.

### 5.5 Activar Firestore

Todos los datos (apuestas, estados pendientes de respuesta) se guardan en
Firestore. Hace falta crearla una sola vez y darle permiso a la cuenta de
servicio del propio Cloud Run:

```bash
gcloud services enable firestore.googleapis.com

gcloud firestore databases create --location=eur3

PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

`--location=eur3` es una región multi-región de Europa; si tu proyecto ya
tiene una base de datos Firestore creada en otra región para otra cosa, no
hace falta repetir el `create`. No hace falta ninguna variable de entorno
nueva: la autenticación es automática vía la cuenta de servicio del propio
servicio (Application Default Credentials).

**Importante**: si tu proyecto de Google Cloud ya lo usa JC Analistas,
puedes reutilizar la misma base de datos Firestore (un solo `create` por
proyecto) — no hay colisión de nombres de colección (`bets`,
`pendingStakeInput`, `pendingOddsInput` aquí, frente a `bets`,
`betCandidates` allí en un proyecto de GCP distinto si los desplegaste
separados). Aun así, se recomienda usar un proyecto de GCP distinto al de
JC Analistas para no mezclar facturación ni cuotas entre los dos negocios.

## Uso

En Telegram, háblale al bot:

- `/start` (o "🏠 Empezar") — mensaje de bienvenida.
- Manda la **foto del ticket** — el bot la lee y registra la apuesta
  automáticamente (deporte, partido, simple/combinada, cuota e importe). Si
  no consigue leer el importe apostado en la imagen, te lo pregunta antes de
  registrarla.
- `/pendientes` (o "📝 Pendientes") — lista las apuestas sin resolver, cada
  una con botones **"✅ Ganada"** / **"❌ Perdida"**. Ambas se resuelven al
  momento sin preguntar nada más: "❌ Perdida" resta el importe apostado,
  "✅ Ganada" calcula el beneficio como importe × (cuota − 1) usando la
  cuota que ya se leyó del ticket al registrar (solo si esa cuota no se
  pudo leer, te la pide en ese momento como excepción).
- `/stats` (o "📊 Stats") — total de apuestas registradas, pendientes,
  ganadas/perdidas, % de acierto y beneficio neto acumulado. No se anuncia
  en /start para no abrumar, pero admite filtros:
  - `/stats simple` o `/stats combinada` — filtra solo por ese tipo.
  - `/stats <deporte>` (ej. `/stats tenis`) — filtra por deporte
    (coincidencia parcial de texto).
- `/bonos` (o "🎁 Bonos Bienvenida") — lista las casas de apuestas con
  enlace de referido y su bono de bienvenida, configuradas en
  `src/config/bonuses.ts` (edita ese array para añadir/quitar casas). Si
  está vacío, responde que todavía no hay bonos configurados.

## Limitaciones conocidas de esta primera versión

- No hay comparador de cuotas con casas afiliadas todavía (ver "Próximos
  pasos" más abajo) — es puro tracking.
- El bot es público: cualquiera que conozca su usuario de Telegram puede
  hablarle y empezar a registrar sus propias apuestas (aisladas del resto).
  No hay registro/login más allá del ID de Telegram.
- Si Gemini no lee bien el deporte o el partido del ticket, se registra tal
  cual (no hay validación contra una lista cerrada de deportes/ligas).
- El agente de visión (`gemini-flash-latest`) puede cambiar de
  comportamiento o disponibilidad, al ser un modelo "latest" de Google.

## Próximos pasos pendientes de decidir

1. Validar qué API de cuotas usar para el comparador de afiliados (coste,
   cobertura de ligas/mercados nicho).
2. Decidir con qué casas de apuestas empezar la afiliación.
3. Revisar el modelo de datos multi-usuario según necesidades reales de uso
   (por ahora: aislamiento simple por ID de Telegram en la colección
   `bets`).
4. Definir qué entra en la capa premium y el precio.

## Estructura del proyecto

```
src/
  bot.ts                    Lógica del bot de Telegram (comandos, botones, flujo de registro)
  server.ts                 Servidor Express + registro del webhook
  config/
    env.ts                   Carga de variables de entorno
  gemini/
    retry.ts                  Reintentos con backoff ante errores transitorios de la API de Gemini
  tickets/
    analyzeTicket.ts           Lectura del ticket por visión de Gemini (deporte, partido, tipo, cuota, importe)
  state/
    pendingInput.ts             Estado en Firestore a la espera de una respuesta del usuario (importe, o cuota si no se pudo leer del ticket)
  stats/
    firestore.ts                Cliente de Firestore (vía ADC)
    betsStore.ts                 Modelo de apuesta + CRUD (pendiente/ganada/perdida) y estadísticas
```
