# Bet Tracker Bot — Bot de Telegram

Réplica en Telegram de una app de registro/estadísticas de apuestas (tipo
Metrika): cero fricción de instalar nada, vive donde ya está el apostador.

1. Mandas la foto del ticket de tu apuesta.
2. El bot la lee (visión de Gemini) y la registra automáticamente:
   deporte, partido (equipos/jugadores + selección), tipo (simple/combinada),
   cuota e importe.
3. Si hay una casa afiliada con mejor cuota para esa misma apuesta, te lo
   dice justo después en un segundo mensaje, con el enlace de registro.
4. Más tarde la marcas como ✅ Ganada o ❌ Perdida con un botón — el
   beneficio se calcula solo, con la cuota que ya se leyó del ticket (no
   hace falta volver a escribirla).
5. `/stats` — aciertos, beneficio, con filtros por deporte y por
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
- (Opcional) Una API key de [The Odds API](https://the-odds-api.com), para el comparador de cuotas

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
`WEBHOOK_SECRET_PATH`) se completan al desplegar (paso 5). `OWNER_TELEGRAM_ID`
y `ODDS_API_KEY` son opcionales — sin ellos, /premium_on/off y el
comparador de cuotas simplemente no se activan, el resto del bot funciona
igual.

## 4. Instalar dependencias

```bash
npm install
```

## 5. Desplegar en Cloud Run

### 5.1 Subir los secretos (token del bot, API key de Gemini y, si la tienes, de The Odds API)

Se guardan en Secret Manager en vez de como variables de entorno planas,
para que no queden visibles en la consola de Cloud Run:

```bash
echo -n "TU_TOKEN_DE_TELEGRAM" | gcloud secrets create telegram-bot-token --data-file=-
echo -n "TU_API_KEY_DE_GEMINI" | gcloud secrets create gemini-api-key --data-file=-
echo -n "TU_API_KEY_DE_ODDS_API" | gcloud secrets create odds-api-key --data-file=-
```

Si alguna vez regeneras alguna, sube una nueva versión:

```bash
echo -n "NUEVO_VALOR" | gcloud secrets versions add telegram-bot-token --data-file=-
echo -n "NUEVO_VALOR" | gcloud secrets versions add gemini-api-key --data-file=-
echo -n "NUEVO_VALOR" | gcloud secrets versions add odds-api-key --data-file=-
```

### 5.2 Construir y desplegar (primera vez)

```bash
gcloud run deploy bet-tracker-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars WEBHOOK_SECRET_PATH=UNA_CADENA_ALEATORIA,OWNER_TELEGRAM_ID=TU_ID_DE_TELEGRAM \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,GEMINI_API_KEY=gemini-api-key:latest,ODDS_API_KEY=odds-api-key:latest \
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

## 6. Configurar Stripe (cobro automático de Premium)

Opcional — sin esto, "⭐ Premium" sigue funcionando con activación manual
(`/premium_on`). Necesita el servicio ya desplegado (paso 5), porque el
webhook de Stripe necesita conocer la URL pública.

### 6.1 Crear la cuenta y el precio

1. Crea una cuenta en [stripe.com](https://stripe.com) (email + verificación).
   No hace falta activar cobros de verdad todavía — con el modo **Test**
   (interruptor arriba a la derecha del Dashboard) ya puedes sacar claves y
   probar todo el flujo con tarjetas de prueba.
2. En el Dashboard: **Product catalog** → **Add product**. Nombre "Premium",
   precio **2,90€**, recurrencia **Monthly**. Guarda y copia el **Price ID**
   (empieza por `price_...`) — es tu `STRIPE_PRICE_ID`.
3. **Developers** → **API keys** → copia la **Secret key** (`sk_test_...`
   en modo Test) — es tu `STRIPE_SECRET_KEY`.

### 6.2 Subir los secretos y desplegar con ellos

```bash
echo -n "TU_SECRET_KEY_DE_STRIPE" | gcloud secrets create stripe-secret-key --data-file=-

PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding stripe-secret-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud run deploy bet-tracker-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --update-env-vars STRIPE_PRICE_ID=TU_PRICE_ID,TELEGRAM_BOT_USERNAME=tu_bot_sin_arroba \
  --update-secrets STRIPE_SECRET_KEY=stripe-secret-key:latest \
  --timeout=300
```

### 6.3 Crear el endpoint del webhook (después de desplegar)

1. En el Dashboard de Stripe: **Developers** → **Webhooks** → **Add endpoint**.
2. URL: `https://TU-URL-DE-CLOUD-RUN.a.run.app/webhooks/stripe`.
3. Eventos a escuchar: `checkout.session.completed`,
   `customer.subscription.deleted`, `invoice.payment_failed`.
4. Al guardar, copia el **Signing secret** (`whsec_...`) — es tu
   `STRIPE_WEBHOOK_SECRET`.

```bash
echo -n "TU_WHSEC" | gcloud secrets create stripe-webhook-secret --data-file=-

gcloud secrets add-iam-policy-binding stripe-webhook-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud run services update bet-tracker-bot \
  --region europe-southwest1 \
  --update-secrets STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest
```

### 6.4 Probar

Pulsa "⭐ Premium" en el bot sin tener premium activo: debe salir el botón
"💳 Suscribirme". En modo Test, paga con la tarjeta de prueba
`4242 4242 4242 4242`, cualquier fecha futura y CVC — el premium se activa
solo en segundos. Cuando quieras cobrar de verdad, cambia el interruptor
Test/Live en Stripe, repite 6.1-6.3 con las claves `sk_live_...`/`whsec_...`
del modo Live, y vuelve a desplegar con esas.

## Uso

En Telegram, háblale al bot:

- `/start` (o "📸 Registrar") — mensaje de bienvenida.
- Manda la **foto del ticket** — el bot la lee y registra la apuesta
  automáticamente (deporte, partido, simple/combinada, cuota e importe). Si
  no consigue leer el importe apostado en la imagen, te lo pregunta antes de
  registrarla. Justo después (mensaje aparte, no bloquea el registro) mira
  si alguna casa afiliada tiene mejor cuota para esa apuesta — ver
  "Comparador de cuotas" más abajo para el alcance exacto.
- `/pendientes` (o "📝 Pendientes") — lista las apuestas sin resolver, cada
  una con 5 botones (los mismos que salen justo al registrar la apuesta):
  - **"✅ Ganada"** — calcula el beneficio como importe × (cuota − 1) usando
    la cuota que ya se leyó del ticket al registrar (solo si esa cuota no
    se pudo leer, te la pide en ese momento como excepción).
  - **"❌ Perdida"** — resta el importe apostado, al momento.
  - **"🔁 Nula"** — la casa anuló el mercado o el partido se suspendió:
    beneficio 0€, como si no hubiera pasado (se te devuelve el importe).
  - **"💵 Cashout"** — te pide el beneficio o pérdida exacto que sacaste
    (puede ser negativo, ej. `-3`) y lo registra tal cual.
  - **"🗑️ Anular"** — borra la apuesta por completo, para cuando se
    registró por error; no deja ningún rastro en las estadísticas.

  El mensaje de confirmación que llega al resolverla (Ganada/Perdida/Nula/
  Cashout) trae dos botones: **"📊 Stats"** (acceso directo al selector de
  periodo) y **"🗑️ Borrar"** (por si se resolvió mal — borra la apuesta ya
  resuelta por completo, igual que "Anular").
- `/stats` (o "📊 Stats") — pregunta primero el periodo con botones (**Mes
  actual**, **Año actual**, **Histórico**, según la fecha en que se
  registró cada apuesta) y luego muestra: apuestas registradas, pendientes,
  resueltas (✅/❌), % de acierto y beneficio. Debajo del resumen hay botones
  ⭐ con filtros y extras — todos exclusivos de **Premium** (ver abajo):
  - ⭐ Stats completas — desglose por tipo (🔹 simple/🔀 combinada) y por
    deporte (con su emoji, ej. ⚽ Fútbol, 🎾 Tenis) en un solo mensaje:
    apuestas, % de acierto y beneficio de cada uno, sin tener que ir
    eligiendo filtro por filtro (`/stats simple`, `/stats combinada` y
    `/stats <deporte>` por texto siguen funcionando igual, también
    premium, si prefieres uno suelto).
  - ⭐ Análisis IA — le pasa a Gemini el desglose por deporte/tipo, por
    rango de cuota, por tamaño de apuesta (importe por debajo/encima de tu
    media) y tu racha actual, y pide un análisis escueto (máximo 8 líneas):
    dónde ganas, dónde pierdes, en qué rango de cuota aciertas más, si el
    importe apostado influye, si la racha actual merece un aviso, y qué
    hacer para mejorar.
  - ⭐ Gráfica — genera una imagen con la evolución del beneficio
    acumulado, agrupado por franjas de tiempo en vez de apuesta a apuesta
    (para que no se amontone si hay muchas): cada 2 días si el periodo es
    Mes actual, cada semana si es Año actual, cada mes si es Histórico.
    Necesita al menos una apuesta resuelta en ese periodo.
  - ⭐ Exportar CSV — manda un archivo `.csv` con el historial completo del
    periodo elegido (fechas, partido, tipo, cuotas, importe, beneficio),
    listo para abrir en Excel/Sheets.
- `/bonos` (o "🎁 Bonos Bienvenida") — lista las casas de apuestas con
  enlace de referido y su bono de bienvenida, configuradas en
  `src/config/bonuses.ts` (edita ese array para añadir/quitar casas). Si
  está vacío, responde que todavía no hay bonos configurados.
- `/premium` (o "⭐ Premium") — si ya tienes premium, lo confirma. Si no,
  y Stripe está configurado, manda un botón "💳 Suscribirme — 2,90€/mes"
  con el link de pago (Stripe Checkout); si Stripe no está configurado,
  cae al mensaje de activación manual.

### Premium

**Cobro automático (Stripe)**: suscripción mensual de 2,90€, vía Stripe
Checkout — ver "6. Configurar Stripe" más abajo. Al pagar, el webhook
`/webhooks/stripe` activa el premium automáticamente; si el usuario cancela
o falla el cobro, se le desactiva solo.

**Activación manual**: sigue disponible como respaldo (o mientras no
configures Stripe). Solo tú (el `OWNER_TELEGRAM_ID` que configures) puedes
usar:

- `/premium_on <ID de Telegram>` — activa premium a ese usuario.
- `/premium_off <ID de Telegram>` — se lo desactiva.

Cualquier otro usuario que intente esos comandos no obtiene respuesta (ni
confirmación de que existen). El estado (incluida la vinculación con el
cliente de Stripe) se guarda en la colección `users` de Firestore.

### Comparador de cuotas

Usa [The Odds API](https://the-odds-api.com) (gratis hasta 500 créditos/mes;
1 consulta = 1 mercado × nº de regiones, aquí siempre `eu,uk` = 2 créditos).
Deliberadamente limitado — si algo no encaja, no manda nada en vez de
arriesgar una comparación equivocada:

- Solo apuestas **simples** (las combinadas quedan fuera: emparejar cada
  pata por separado y recalcular la cuota conjunta es mucho más complejo).
- Solo **fútbol** (La Liga, Premier League, Bundesliga, Champions League —
  la fase que esté activa) y **tenis** (cualquier torneo ATP/WTA que la API
  tenga activo esa semana; no hay una clave fija "ATP", se resuelve en vivo
  contra su catálogo cada hora).
- Solo mercado **ganador del partido** (1X2 en fútbol, gana el partido en
  tenis) — nada de hándicaps, sets, over/under, etc.
- Solo compara contra las casas de `src/config/bonuses.ts` que la propia
  API cubre de verdad (comprobado a mano): **Winamax, Betfair, William
  Hill, Betway y 888 Sport**. Sportium y PokerStars no aparecen en su
  catálogo, así que quedan fuera del comparador (siguen apareciendo en
  🎁 Bonos Bienvenida).
- El equipo/jugador del ticket se empareja con el de la API por
  solapamiento de palabras (evita confundir derbis tipo Real Madrid /
  Atlético Madrid / Real Sociedad); si hay cualquier ambigüedad, no compara.

Con varias ligas de fútbol + los torneos de tenis activos, una sola
comparación puede consultar varias ligas seguidas hasta encontrar el
partido — el gasto real de créditos por ticket varía bastante semana a
semana (más partidos de tenis en juego = más consultas). Vigila el consumo
en el dashboard de The Odds API los primeros días.

## Limitaciones conocidas de esta primera versión

- El bot es público: cualquiera que conozca su usuario de Telegram puede
  hablarle y empezar a registrar sus propias apuestas (aisladas del resto).
  No hay registro/login más allá del ID de Telegram.
- Si Gemini no lee bien el deporte o el partido del ticket, se registra tal
  cual (no hay validación contra una lista cerrada de deportes/ligas).
- El agente de visión (`gemini-flash-latest`) puede cambiar de
  comportamiento o disponibilidad, al ser un modelo "latest" de Google.

## Próximos pasos pendientes de decidir

1. Ampliar el comparador de cuotas más allá de fútbol/tenis y del mercado
   ganador, y decidir si pasar a un plan de pago de The Odds API según el
   consumo real de créditos.
2. Sumar más casas afiliadas que sí cubra la API (o buscar otra fuente de
   cuotas para Sportium/PokerStars).
3. Revisar el modelo de datos multi-usuario según necesidades reales de uso
   (por ahora: aislamiento simple por ID de Telegram en la colección
   `bets`).
4. Pasar Stripe de modo Test a Live cuando quieras cobrar de verdad (ver
   "6. Configurar Stripe").

## Estructura del proyecto

```
src/
  bot.ts                    Lógica del bot de Telegram (comandos, botones, flujo de registro)
  server.ts                 Servidor Express + registro del webhook
  config/
    env.ts                   Carga de variables de entorno
    bonuses.ts                Casas de apuestas afiliadas para "🎁 Bonos Bienvenida"
  gemini/
    retry.ts                  Reintentos con backoff ante errores transitorios de la API de Gemini
  tickets/
    analyzeTicket.ts           Lectura del ticket por visión de Gemini (deporte, partido, tipo, cuota, importe)
  state/
    pendingInput.ts             Estado en Firestore a la espera de una respuesta del usuario (importe, o cuota si no se pudo leer del ticket)
  premium/
    premiumStore.ts             Estado premium por usuario en Firestore (colección `users`)
  charts/
    profitChart.ts               Gráfica de evolución del beneficio (SVG -> PNG con sharp), premium
  export/
    csvExport.ts                 Exportación del historial a CSV, premium
  odds/
    oddsApiClient.ts              Cliente HTTP de The Odds API
    leagueCatalog.ts               Resuelve qué ligas/torneos comprobar (con caché de 1h)
    matching.ts                    Emparejar equipos/jugadores y detectar el lado de la selección
    bookmakerMap.ts                 Mapeo de casas de bonuses.ts a claves de bookmaker de la API
    matchOdds.ts                    Orquesta todo lo anterior: busca mejor cuota para una apuesta
  analysis/
    aiAnalysis.ts                   Análisis IA (Gemini) del desglose de stats, premium
  payments/
    stripeClient.ts                 Cliente de Stripe + creación de la sesión de Checkout
    stripeWebhook.ts                 Maneja checkout.session.completed / cancelación / impago
  stats/
    firestore.ts                Cliente de Firestore (vía ADC)
    betsStore.ts                 Modelo de apuesta + CRUD (pendiente/ganada/perdida) y estadísticas
```
