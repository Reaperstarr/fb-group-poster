# 🚀 FB Group Poster Pro — Guía de Instalación

## Pasos para instalar (sin cuenta de desarrollador)

### 1. Descarga y extrae el ZIP
- Descarga el archivo `fb-group-poster.zip`
- Extráelo en una carpeta que no vayas a mover (ej: `Documentos/fb-group-poster`)

### 2. Abre Chrome y ve a Extensiones
- Escribe en la barra de URL: `chrome://extensions`
- O ve a: Menú (⋮) → Más herramientas → Extensiones

### 3. Activa el Modo Desarrollador
- En la esquina superior derecha, activa el switch **"Modo de desarrollador"**

### 4. Carga la extensión
- Haz clic en **"Cargar descomprimida"**
- Selecciona la carpeta donde extrajiste el ZIP (`fb-group-poster`)
- ¡Listo! Verás el ícono naranja en la barra de Chrome

---

## Cómo usar

### Paso 1 — Escribe tu mensaje
- Haz clic en el ícono de la extensión (🚀 naranja)
- Ve a la pestaña **✍️ Mensaje**
- Escribe tu texto con formato (negrita, cursiva, listas...)
- Agrega emojis con los botones rápidos
- Sube imágenes (máx. 5)

### Paso 2 — Agrega tus grupos
- Ve a **👥 Grupos**
- Pega la URL de cada grupo de Facebook
- Ejemplos válidos:
  - `https://www.facebook.com/groups/mi-grupo-de-ventas`
  - `https://www.facebook.com/groups/123456789`
- Marca/desmarca grupos con el checkbox

### Paso 3 — Configura el timer
- Ve a **⏱️ Timer**
- Activa el timer y ajusta los segundos entre cada post
- Agrega variación aleatoria para mayor naturalidad

### Paso 4 — Inicia
- Haz clic en **🚀 Iniciar posts**
- La extensión abrirá cada grupo automáticamente
- Sigue el progreso en la pestaña **📊 Estado**

---

## ⚠️ Requisitos importantes

1. **Debes estar logueado en Facebook** en Chrome
2. **Debes ser miembro** de cada grupo donde quieras postear
3. **No minimices Chrome** mientras el proceso está corriendo
4. Facebook puede cambiar su interfaz — si falla un grupo, intenta manualmente

## ❓ Solución de problemas

| Problema | Solución |
|----------|----------|
| "No se encontró el cuadro de post" | Asegúrate de ser miembro del grupo y estar en la página correcta |
| La extensión no aparece | Verifica que cargaste la carpeta completa, no un archivo individual |
| Error al publicar | Cierra sesión y vuelve a iniciarla en Facebook |
| Muchos errores seguidos | Aumenta el timer a 60+ segundos para evitar bloqueos temporales |

---

*FB Group Poster Pro — uso personal, respeta los términos de servicio de Facebook.*

---

## Monetización (Stripe + Licencias)

La app ya incluye:
- Checkout Pro (`Go Pro (Unlimited)`).
- Pantalla `Activate license`.
- Validación online por endpoint.
- Reglas Free/Pro:
  - Free: máximo 3 posteos exitosos por día.
  - Pro: posteos ilimitados.

### Backend mínimo incluido

Se agregó `license-server/` con:
- `server.js`: endpoints de validación + webhook de Stripe.
- `package.json`: dependencia `stripe`.
- `.env.example`: variables necesarias.

### Endpoints

- `POST /api/license/validate`  
  Recibe `{ "licenseKey": "..." }` y responde `{ valid: true/false, plan, message }`.

- `POST /api/stripe/webhook`  
  Procesa `checkout.session.completed` y activa licencia.

- `POST /api/license/create-demo`  
  Crea licencia manual por email (solo pruebas).

- `GET /health`  
  Health check.

### Correr local

1. Ir a `license-server/`
2. `npm install`
3. Copiar `.env.example` a `.env` y completar claves
4. `npm start`

La URL de validación para la extensión será:
- `http://localhost:8787/api/license/validate` (local)

### Webhook Stripe (producción)

1. Desplegar `license-server` en tu servidor (Render/Railway/VPS).
2. Configurar variables de entorno:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `RESEND_API_KEY` (opcional, para enviar licencia por email)
   - `EMAIL_FROM`
3. En Stripe, crear webhook hacia:
   - `https://tu-dominio.com/api/stripe/webhook`
4. Eventos recomendados:
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`

Con esto:
- compra exitosa => activa licencia automáticamente
- pago fallido/cancelación => desactiva licencia
- control por dispositivo (por defecto: 1 dispositivo por licencia)

### Seguridad mínima recomendada

- No subir `.env` real al repo (ya se ignora por `.gitignore`).
- No subir `license-server/licenses.json` (contiene emails/licencias).
- Endpoint demo `create-demo`:
  - deshabilitado por defecto con `ALLOW_DEMO_ENDPOINT=false`
  - si lo activas, requiere `ADMIN_API_TOKEN`
- Límite de dispositivos:
  - `MAX_DEVICES_PER_LICENSE=1` (recomendado para tu caso)
  - primera validación vincula la licencia al dispositivo
  - otro dispositivo con misma licencia => validación rechazada

Ejemplo seguro para demo:

```bash
curl -X POST "https://tu-dominio.com/api/license/create-demo" \
  -H "Authorization: Bearer TU_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente@dominio.com","plan":"PRO"}'
```

Si necesitas mover una licencia a otra PC (soporte):

```bash
curl -X POST "https://tu-dominio.com/api/license/reset-device" \
  -H "Authorization: Bearer TU_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"TU_LICENSE_KEY"}'
```
