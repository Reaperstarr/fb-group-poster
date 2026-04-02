# Manatal CV mirror (Azure)

Servidor Node que recibe el PDF desde la **extensión Manatal** (`POST` multipart) y lo guarda en:

- **Azure Blob Storage** (recomendado si no tenés Microsoft 365 / licencia SharePoint), o
- **OneDrive de empresa** vía **Microsoft Graph** (app Entra + `GRAPH_TARGET_USER_ID`).

Si definís **`AZURE_STORAGE_CONNECTION_STRING`** en la Web App, se usa **solo Blob** y no hace falta `AZURE_TENANT_ID` / Graph para subir. **`/health`** incluye `"storage":"blob"` o `"onedrive"`.

## Qué URL poner en la extensión

```
https://<TU-APP>.azurewebsites.net/upload
```

(Sustituí `<TU-APP>` por el nombre que elijas al crear la Web App.)

Si configurás `MIRROR_API_KEY` en Azure, en la extensión rellená también **Clave API del espejo** (cabecera `X-Api-Key`).

---

## Paso a paso en Azure Portal

### 1) Crear la Web App

1. [Azure Portal](https://portal.azure.com) → **Create a resource**.
2. Buscar **Web App** → **Create**.
3. **Subscription / Resource group**: el que uses (podés crear un grupo nuevo, ej. `rg-manatal-mirror`).
4. **Name**: nombre único global → será `https://<Name>.azurewebsites.net`.
5. **Publish**: Code. **Runtime stack**: **Node 20 LTS** (o 18). **OS**: Linux.
6. **Region**: la más cercana.
7. **Pricing plan**: el más barato suele bastar (Basic B1 o Free F1 para pruebas; F1 tiene límites).
8. **Review + create** → **Create**.

### 2) Variables de entorno (Application settings)

En la Web App → **Settings** → **Environment variables** → **Application settings** → **Add**.

**Opción sin M365 — Blob Storage**

1. Portal → **Create a resource** → **Storage account** → crear (mismo resource group que la Web App está bien). **Redundancy** LRS alcanza para pruebas; **Public access** puede dejarse en deshabilitado (el servidor usa SAS).
2. **Storage account** → **Containers** → **+ Container** → nombre `manatal-cv` (o el que pongas en `AZURE_STORAGE_CONTAINER`).
3. **Access keys** → copiar **Connection string** (key1).

| Nombre | Valor |
|--------|--------|
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string completa |
| `AZURE_STORAGE_CONTAINER` | Opcional; por defecto `manatal-cv` |
| `CV_UPLOAD_FOLDER` | Opcional; prefijo de “carpeta” dentro del contenedor (ej. `ManatalCV`) |
| `BLOB_SAS_EXPIRY_DAYS` | Opcional; días de validez del enlace de lectura (por defecto `365`) |
| `MIRROR_API_KEY` | Opcional; misma clave en la extensión |

Podés **eliminar** de la Web App las variables de Graph (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GRAPH_TARGET_USER_ID`) si solo usás Blob.

**Opción OneDrive (Graph + M365/SPO en el tenant)**

| Nombre | Valor |
|--------|--------|
| `AZURE_TENANT_ID` | Directory (tenant) ID de Entra |
| `AZURE_CLIENT_ID` | Application (client) ID de **ManatalCV** |
| `AZURE_CLIENT_SECRET` | El **Value** del client secret (no el Secret ID) |
| `GRAPH_TARGET_USER_ID` | Object ID del usuario cuyo OneDrive guardará los CV (ver abajo) |
| `CV_UPLOAD_FOLDER` | Opcional; por defecto `ManatalCV` |
| `MIRROR_API_KEY` | Opcional; si lo pones, misma clave en la extensión |

**No** definas `AZURE_STORAGE_CONNECTION_STRING` si querés seguir con OneDrive.

**WEBSITES_PORT**: Azure lo suele inyectar solo; no hace falta tocarlo.

Guardá y **reiniciá** la app (**Overview** → **Restart**).

#### Dónde sale `GRAPH_TARGET_USER_ID`

**Microsoft Entra ID** → **Users** → el usuario (ej. buzón dedicado “cv-mirror@…”) → copiar **Object ID** (GUID). Ese usuario debe tener licencia con OneDrive si el tenant lo exige.

### 3) Desplegar el código

**Opción A — Zip (rápido)**

1. En tu PC, dentro de `manatal-cv-mirror/`: `npm install` y luego comprimí **el contenido** de la carpeta ( `package.json`, `package-lock.json`, `server.js`, `node_modules` **o** sin `node_modules` y build remoto).

   En Azure: Web App → **Deployment Center** → **Local Git** o **ZIP Deploy** según preferencia.

   Lo más simple: **Advanced Tools (Kudu)** → **Debug console** → **CMD** → arrastrar zip a `site/wwwroot` **o** usar **Deployment Center** → **FTPS credentials** / **VS Code Azure extension**.

2. En muchos casos lo más limpio es **GitHub Actions** desde el repo (Deployment Center → GitHub).

**Opción B — Desde Cursor / terminal (Azure CLI)**

```bash
cd manatal-cv-mirror
npm install
# crear zip con package.json, package-lock.json, server.js, node_modules
az webapp up --name <TU-APP> --resource-group <TU-RG> --runtime "NODE:20-lts"
```

(Ajustá según tengas CLI logueado y runtime disponible en tu región.)

**Opción C — GitHub Actions (repo con workflow `main_mirrorcv.yml`)**

1. En Azure: Web App **mirrorcv** → **Overview** → **Get publish profile** (descarga un `.PublishSettings` XML).
2. En GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Nombre: `AZURE_WEBAPP_PUBLISH_PROFILE`
   - Valor: **pega el contenido completo** del XML (todo el archivo).
3. Hacé push a `main` tocando `manatal-cv-mirror/**` o el workflow; la acción ejecuta `npm ci` y despliega la carpeta `manatal-cv-mirror` a la app.

**Startup command** (si hace falta): en **Configuration** → **General settings** → **Startup Command**:

```bash
node server.js
```

O dejá vacío si **npm start** está definido en `package.json` (Azure suele ejecutar `npm start` si detecta Node).

### 4) Probar

```bash
curl -sS "https://<TU-APP>.azurewebsites.net/health"
```

Debe responder JSON `{"ok":true,...}`.

Luego en la extensión: **URL del espejo de CV** = `https://<TU-APP>.azurewebsites.net/upload`.

---

## Desarrollo local

```bash
cp .env.example .env
# completar .env
npm install
npm run dev
```

Prueba: `curl -F "file=@./test.pdf" -F "manatalId=12345" http://localhost:8787/upload`

---

## Seguridad

- No commitees `.env` ni el client secret.
- `MIRROR_API_KEY` recomendado en producción.
- `Files.ReadWrite.All` es amplio; a medio plazo se puede acotar (por ejemplo sitio/carpeta concreta) con ayuda de un admin.
