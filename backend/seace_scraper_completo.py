"""
seace_scraper_completo.py
=========================
Extrae TODOS los procesos de SEACE (prod6) con:
  - Detalle completo (listar-completo)
  - Archivos del contrato (listar-archivos-contrato)
  - Links de descarga de cada archivo
  - Descarga física de los PDFs/DOCX
  - Refresh automático de token cada 4 minutos
  - Guardado incremental en JSON (si falla a mitad, no pierdes nada)

Flujo:
  1. Selenium → login + aceptar T&C → captura token + refreshToken
  2. Selenium se cierra
  3. requests puro → extrae todo a máxima velocidad con ThreadPoolExecutor

CONFIGURACIÓN ──────────────────────────────────────────────────────────────
"""
import json
import os
import re
import sys
import time
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests
import mysql.connector
from mysql.connector import pooling
import openpyxl
from openpyxl.utils import get_column_letter
import aiohttp
import asyncio
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from playwright.async_api import async_playwright

from dotenv import load_dotenv
load_dotenv()

# ─── EVITAR DOBLE IMPORTACIÓN DEL MÓDULO ─────────────────────────────────────
# Al ejecutar este archivo directamente (python seace_scraper_completo.py),
# Python lo carga como el módulo "__main__". Pero seace_cotizaciones.py hace
# `import seace_scraper_completo` en varias funciones (import diferido) — y
# como no existe registrado bajo ESE nombre, Python lo vuelve a importar
# desde disco, creando una SEGUNDA copia completamente aislada de todas las
# variables globales (_empresa_seleccionada, _sesiones, EMPRESAS, etc.).
# Esta línea registra el módulo actual también bajo su nombre de archivo,
# para que cualquier `import seace_scraper_completo` posterior reutilice
# esta MISMA instancia en vez de crear una copia nueva.
import sys
sys.modules.setdefault("seace_scraper_completo", sys.modules[__name__])

# ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
# ─── STORAGE: local (Documentos) o nube (Azure/AWS) ─────────────────────────
# Para usar Azure Blob Storage: pon en .env  STORAGE_BACKEND=azure
# Para usar AWS S3:             pon en .env  STORAGE_BACKEND=aws
# Sin nada (default):           guarda en ~/Documentos/SEACE_PLADIBOT
STORAGE_BACKEND   = os.getenv("STORAGE_BACKEND", "local")   # local | azure | aws
AZURE_CONN_STR    = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_CONTAINER   = os.getenv("AZURE_CONTAINER_NAME", "seace-archivos")
AWS_BUCKET        = os.getenv("AWS_BUCKET_NAME", "seace-archivos")
AWS_REGION        = os.getenv("AWS_REGION", "us-east-1")

# ─── CARPETA LOCAL DINÁMICA (siempre apunta a ~/Documentos del usuario actual)
_DOCS = Path("D:/")         # Windows: C:\Users\<quien sea>\Documents
if not _DOCS.exists():                      # fallback si no existe la carpeta
    _DOCS = Path.home()

# Producción (Coolify): si SEACE_PLADIBOT_DIR está seteada, se usa DIRECTO
# (debe ser el Destination Path del volumen persistente: /app/seace_docs)
_CARPETA_ENV = os.getenv("SEACE_PLADIBOT_DIR")

# ─── CONFIGURACIÓN MULTIEMPRESA ──────────────────────────────────────────────
# Contraseñas en .env, no hardcodeadas. Agrega SEACE_PASSWORD_<RUC> por cada
# empresa vinculada al RNP.
EMPRESAS = {
    "20606951711": {
        "ruc": "20606951711",
        "password": os.getenv("SEACE_PASSWORD_20606951711", "Eco.20263"),
        "razon_social": "ECOLIMP EMPRESARIAL E.I.R.L.",
    },
    "20611043873": {
        "ruc": "20611043873",
        "password": os.getenv("SEACE_PASSWORD_20611043873", "Ge.20263"),
        "razon_social": "GRUPO ECOLIMP E.I.R.L",
    },
    "20608980963": {
    "ruc": "20608980963",
    "password": os.getenv("SEACE_PASSWORD_20608980963", "Multi.2026"),
    "razon_social": "MULTILIMP S.A.C.",
    },
}

# El scraper masivo (extraer/todo, extraer/vigentes) sigue usando la primera
# empresa de la lista como cuenta principal — no se toca ese flujo.
RUC               = list(EMPRESAS.keys())[0]
PASSWORD          = EMPRESAS[RUC]["password"]
ANIO              = 2026
PAGE_SIZE         = 5000

DESCARGAR_ARCHIVOS = True
CARPETA_SALIDA    = Path(_CARPETA_ENV) if _CARPETA_ENV else (_DOCS / "SEACE_PLADIBOT")
ARCHIVO_JSON      = CARPETA_SALIDA / "procesos.json"
ARCHIVO_LOG       = CARPETA_SALIDA / "log.txt"  


# ─── CONFIGURACIÓN EMAIL ──────────────────────────────────────────────────────
SMTP_SERVER      = "in-v3.mailjet.com"
SMTP_PORT        = 587
EMAIL_REMITENTE  = "eee876884b22dbf9ea14870d16891037"
EMAIL_PASSWORD   = "b7af5c04b55b17f5c8856d1a8c22d34d"
EMAILS_DESTINO   = [
    "melvalanderson1@gmail.com",
    "ventas@multilimpsac.com",
]


import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import uvicorn
from fastapi import FastAPI, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
import asyncio

from fastapi.middleware.cors import CORSMiddleware
from auth import requiere_rol, requiere_modulo, get_current_user

app = FastAPI(title="PLADIBOT API")
_tarea_activa = {"corriendo": False, "modo": None}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from seace_cotizaciones import router as cotizaciones_router
app.include_router(cotizaciones_router)


BASE_URL          = "https://prod6.seace.gob.pe"
URL_LOGIN         = f"{BASE_URL}/auth-proveedor/"
URL_LOGIN_API     = f"{BASE_URL}/v1/s8uit-services/seguridadproveedor/seguridad/tokens/obtener"
URL_BUSCADOR      = f"{BASE_URL}/v1/s8uit-services/contratacion/contrataciones/buscador"
URL_DETALLE       = f"{BASE_URL}/v1/s8uit-services/contratacion/contrataciones/listar-completo"
URL_DETALLE_COT   = f"{BASE_URL}/v1/s8uit-services/cotizacion/cotizaciones/listar-completo"
URL_OBTENER_COT   = f"{BASE_URL}/v1/s8uit-services/contratacion/contrataciones/obtener-completo"
URL_ARCHIVOS      = f"{BASE_URL}/v1/s8uit-services/archivo/archivos/listar-archivos-contrato"
URL_DESCARGA      = f"{BASE_URL}/v1/s8uit-services/archivo/archivos/descargar-archivo-contrato"
URL_REFRESH       = f"{BASE_URL}/v1/s8uit-services/seguridadproveedor/seguridad/tokens/refresh"




# ─── CONFIGURACIÓN BASE DE DATOS ─────────────────────────────────────────────
DB_CONFIG = {
    "host"    : os.getenv("MYSQL_HOST", "localhost"),
    "port"    : int(os.getenv("MYSQL_PORT", "3306")),
    "user"    : os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "pladibot_db"),
    "charset" : "utf8mb4",
}
_db_pool = None

def _init_pool():
    global _db_pool
    if _db_pool is not None:
        return
    _db_pool = pooling.MySQLConnectionPool(
        pool_name="seace", pool_size=10, **DB_CONFIG
    )

def _get_conn():
    return _db_pool.get_connection()

# ─── ESTADO GLOBAL DE SESIÓN (thread-safe) ───────────────────────────────────
_lock_token  = threading.Lock()
_token       = None
_refresh_tok = None
_username    = RUC
_ip_terminal = "179.6.43.32"

# Cada empresa adicional (distinta de la cuenta principal) usa su propio
# identificador de "terminal" para que SEACE no confunda sus sesiones con
# la de la cuenta principal ni entre sí.
_TERMINALES_EMPRESA = {
    ruc: f"179.6.43.{40 + i}"
    for i, ruc in enumerate(EMPRESAS)
    if ruc != RUC
}

def _terminal_empresa(ruc):
    return _TERMINALES_EMPRESA.get(ruc, _ip_terminal)
_session_estado = {"activa": False, "conectado_en": None, "error": None}

TOKEN_FILE = CARPETA_SALIDA / "token_sesion.json"

def _guardar_token_disco():
    try:
        CARPETA_SALIDA.mkdir(parents=True, exist_ok=True)
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": _token, "refresh": _refresh_tok}, f)
    except Exception as e:
        log(f"⚠️ No se pudo guardar token en disco: {e}", "WARN")

def _cargar_token_disco():
    try:
        if TOKEN_FILE.exists():
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("token"), data.get("refresh")
    except Exception as e:
        log(f"⚠️ No se pudo leer token de disco: {e}", "WARN")
    return None, None

def obtener_token_actual():
    global _token, _refresh_tok
    if not _token:
        tok, ref = _cargar_token_disco()
        if tok:
            _token = tok
            _refresh_tok = ref
            log("🔁 Token recuperado desde disco (fallback)", "INFO")
    return _token


# ─── ESTADO GLOBAL DE SESIÓN — MULTIEMPRESA (flujo de cotizaciones) ──────────
# Cada empresa (RUC) tiene su sesión propia en memoria, independiente de la
# cuenta principal de arriba. `_empresa_seleccionada` indica cuál se usa para
# guardar borrador / subir archivo / eliminar / enviar cotización.
_lock_sesiones = threading.Lock()
_sesiones = {
    ruc: {"token": None, "refresh": None, "activa": False, "conectado_en": None, "error": None}
    for ruc in EMPRESAS
}
_empresa_seleccionada = RUC  # por defecto, la cuenta principal

def _token_file_empresa(ruc):
    return CARPETA_SALIDA / f"token_sesion_{ruc}.json"

def _guardar_token_disco_empresa(ruc):
    try:
        CARPETA_SALIDA.mkdir(parents=True, exist_ok=True)
        with open(_token_file_empresa(ruc), "w", encoding="utf-8") as f:
            json.dump({"token": _sesiones[ruc]["token"], "refresh": _sesiones[ruc]["refresh"]}, f)
    except Exception as e:
        log(f"⚠️ No se pudo guardar token en disco (empresa {ruc}): {e}", "WARN")

def _cargar_token_disco_empresa(ruc):
    try:
        path = _token_file_empresa(ruc)
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("token"), data.get("refresh")
    except Exception as e:
        log(f"⚠️ No se pudo leer token de disco (empresa {ruc}): {e}", "WARN")
    return None, None

def obtener_token_empresa(ruc=None):
    ruc = ruc or _empresa_seleccionada
    if ruc == RUC:
        # La cuenta principal comparte sesión con el scraper masivo:
        # NUNCA loguear dos veces el mismo RUC por caminos distintos,
        # o SEACE cierra una sesión al detectar la otra ("inicio otra").
        return obtener_token_actual()
    if ruc not in _sesiones:
        return None
    with _lock_sesiones:
        tok = _sesiones[ruc]["token"]
    if not tok:
        tok, ref = _cargar_token_disco_empresa(ruc)
        if tok:
            with _lock_sesiones:
                _sesiones[ruc]["token"] = tok
                _sesiones[ruc]["refresh"] = ref
            log(f"🔁 Token recuperado desde disco (empresa {ruc})", "INFO")
    return tok

def _headers_base_empresa(ruc=None):
    ruc = ruc or _empresa_seleccionada
    if ruc == RUC:
        return _headers_base()
    tok = obtener_token_empresa(ruc)
    return {
        "accept"          : "application/json, text/plain, */*",
        "accept-language" : "es-ES,es;q=0.9",
        "authorization"   : f"Bearer {tok}",
        "cache-control"   : "no-cache",
        "pragma"          : "no-cache",
        "sec-fetch-dest"  : "empty",
        "sec-fetch-mode"  : "cors",
        "sec-fetch-site"  : "same-origin",
        "user-agent"      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "origin"          : BASE_URL,
        "client-s8uit"    : json.dumps({"terminal": _terminal_empresa(ruc)}),
    }

def refresh_token_empresa(ruc=None):
    ruc = ruc or _empresa_seleccionada
    if ruc == RUC:
        return refresh_token()
    with _lock_sesiones:
        rt = _sesiones.get(ruc, {}).get("refresh")

    if not rt:
        log(f"⚠️ No hay refreshToken disponible (empresa {ruc}).", "WARN")
        with _lock_sesiones:
            _sesiones[ruc]["activa"] = False
            _sesiones[ruc]["error"] = "Sesión expirada. Vincula de nuevo."
        return False

    try:
        r = requests.post(
            URL_REFRESH,
            json={"refreshToken": rt, "username": ruc},
            headers={
                "accept"       : "application/json, text/plain, */*",
                "content-type" : "application/json",
                "client-s8uit" : json.dumps({"terminal": _terminal_empresa(ruc)}),
                "cache-control": "no-cache",
                "pragma"       : "no-cache",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
            },
            timeout=15
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("respuesta"):
                with _lock_sesiones:
                    _sesiones[ruc]["token"] = data["token"]
                    _sesiones[ruc]["refresh"] = data.get("refreshToken", rt)
                    _sesiones[ruc]["activa"] = True
                    _sesiones[ruc]["error"] = None
                _guardar_token_disco_empresa(ruc)
                log(f"🔄 Token renovado OK (empresa {ruc})")
                return True
        log(f"⚠️ Refresh falló (empresa {ruc}): {r.status_code} {r.text[:120]}", "WARN")
    except Exception as e:
        log(f"⚠️ Refresh error (empresa {ruc}): {e}", "WARN")
    with _lock_sesiones:
        _sesiones[ruc]["activa"] = False
        _sesiones[ruc]["error"] = "No se pudo renovar la sesión con SEACE"
    return False

async def _vincular_empresa_async(ruc):
    if ruc not in EMPRESAS:
        return
    if ruc == RUC:
        # Usa el flujo de la cuenta principal: así nunca hay dos logins
        # simultáneos para el mismo RUC.
        await _vincular_sesion_async()
        return
    with _lock_sesiones:
        _sesiones[ruc]["error"] = None
    try:
        password = EMPRESAS[ruc]["password"]
        token, refresh = await login_playwright(ruc, password)
        if token:
            with _lock_sesiones:
                _sesiones[ruc]["token"] = token
                _sesiones[ruc]["refresh"] = refresh
                _sesiones[ruc]["activa"] = True
                _sesiones[ruc]["conectado_en"] = datetime.now().isoformat()
                _sesiones[ruc]["error"] = None
            _guardar_token_disco_empresa(ruc)
            nombre_hilo = f"auto_refresh_{ruc}"
            ya_corriendo = any(t.name == nombre_hilo for t in threading.enumerate())
            if not ya_corriendo:
                hilo = threading.Thread(
                    target=_auto_refresh_loop_empresa, args=(ruc, 180), daemon=True, name=nombre_hilo
                )
                hilo.start()
                log(f"⏰ Auto-refresh iniciado (empresa {ruc}).")
        else:
            with _lock_sesiones:
                _sesiones[ruc]["activa"] = False
                _sesiones[ruc]["error"] = "No se pudo obtener el token de sesión"
    except Exception as e:
        with _lock_sesiones:
            _sesiones[ruc]["activa"] = False
            _sesiones[ruc]["error"] = str(e)
        log(f"❌ Error vinculando empresa {ruc}: {e}", "ERROR")

def _auto_refresh_loop_empresa(ruc, intervalo_seg=180):
    while not _stop_refresh.wait(timeout=intervalo_seg):
        with _lock_sesiones:
            activa = _sesiones.get(ruc, {}).get("activa")
        if not activa:
            return
        log(f"⏰ Auto-refresh de token (empresa {ruc})...")
        refresh_token_empresa(ruc)

# ─── LOGGING ─────────────────────────────────────────────────────────────────
CARPETA_SALIDA.mkdir(exist_ok=True)
_log_lock = threading.Lock()

def log(msg, level="INFO"):
    ts  = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    print(line, flush=True)
    with _log_lock:
        CARPETA_SALIDA.mkdir(parents=True, exist_ok=True)  # ← ESTA LÍNEA
        with open(ARCHIVO_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")




# ─────────────────────────────────────────────────────────────────────────────
# HELPER: GUARDAR ARCHIVO (local / Azure / AWS)
# ─────────────────────────────────────────────────────────────────────────────

def guardar_bytes_archivo(contenido: bytes, carpeta_destino: Path,
                          id_archivo, nombre_archivo: str):
    """
    Guarda `contenido` según STORAGE_BACKEND.
    Devuelve (ruta_o_url: str, bytes: int)
    """
    nombre_limpio = re.sub(r'[<>:"/\\|?*]', '_', nombre_archivo)

    if STORAGE_BACKEND == "azure":
        try:
            from azure.storage.blob import BlobServiceClient
            blob_name = f"{id_archivo}_{nombre_limpio}"
            client = BlobServiceClient.from_connection_string(AZURE_CONN_STR)
            blob   = client.get_blob_client(container=AZURE_CONTAINER, blob=blob_name)
            blob.upload_blob(contenido, overwrite=True)
            url = blob.url
            log(f"   ☁️ Azure subido: {blob_name} ({len(contenido):,} bytes)")
            return url, len(contenido)
        except Exception as e:
            log(f"   ❌ Error Azure: {e}", "ERROR")
            return None, 0

    if STORAGE_BACKEND == "aws":
        try:
            import boto3
            s3_key = f"{id_archivo}_{nombre_limpio}"
            s3 = boto3.client("s3", region_name=AWS_REGION)
            s3.put_object(Bucket=AWS_BUCKET, Key=s3_key, Body=contenido)
            url = f"https://{AWS_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
            log(f"   ☁️ AWS S3 subido: {s3_key} ({len(contenido):,} bytes)")
            return url, len(contenido)
        except Exception as e:
            log(f"   ❌ Error AWS S3: {e}", "ERROR")
            return None, 0

    # ── LOCAL (default) ───────────────────────────────────────────────────────
    carpeta_destino.mkdir(parents=True, exist_ok=True)
    ruta = carpeta_destino / f"{id_archivo}_{nombre_limpio}"
    with open(ruta, "wb") as f:
        f.write(contenido)
    log(f"   📥 Guardado local: {ruta.name} ({len(contenido):,} bytes)")
    return str(ruta.resolve()), len(contenido)


# ─────────────────────────────────────────────────────────────────────────────
# LIMPIEZA: solo Vigente conserva archivos. En Evaluación / Culminado se borran.
# ─────────────────────────────────────────────────────────────────────────────

def eliminar_archivos_contrato(id_contrato):
    """Borra físicamente la carpeta de archivos de un contrato (dejó de ser
    Vigente) y limpia ruta_local en BD. Devuelve True si OK, False si falló."""
    import shutil
    carpeta = CARPETA_SALIDA / "archivos" / str(id_contrato)
    try:
        if carpeta.exists():
            shutil.rmtree(carpeta)
            log(f"   🗑️ [{id_contrato}] Carpeta eliminada: {carpeta}", "INFO")
        else:
            log(f"   ⚪ [{id_contrato}] No había carpeta que borrar (ya estaba limpio)", "INFO")
    except Exception as e:
        log(f"   ❌ [{id_contrato}] ERROR borrando carpeta {carpeta}: {e}", "ERROR")
        return False

    try:
        conn = _get_conn()
        cur  = conn.cursor()
        cur.execute("UPDATE archivos SET ruta_local = NULL WHERE id_contrato=%s", (id_contrato,))
        filas = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        log(f"   🧹 [{id_contrato}] ruta_local limpiada en BD ({filas} registros)", "INFO")
        return True
    except Exception as e:
        log(f"   ❌ [{id_contrato}] ERROR limpiando ruta_local en BD: {e}", "ERROR")
        return False


def limpiar_archivos_no_vigentes():
    """
    Barre TODOS los contratos que NO están en estado Vigente (id_estado_contrato != 2)
    y borra su carpeta de archivos si todavía existe en disco.
    Se ejecuta al arrancar cada corrida del scraper, como red de seguridad,
    además del borrado en tiempo real que ocurre cuando un contrato cambia de estado.
    """
    log("🧹 Iniciando limpieza de archivos de contratos NO vigentes...", "INFO")
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("SELECT id_contrato, nom_estado_contrato FROM contratos WHERE id_estado_contrato != 2")
        no_vigentes = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        log(f"❌ Limpieza abortada: no se pudo consultar BD: {e}", "ERROR")
        return

    carpeta_base = CARPETA_SALIDA / "archivos"
    if not carpeta_base.exists():
        log("🧹 Limpieza: no existe carpeta 'archivos' aún, nada que hacer.", "INFO")
        return

    encontradas = 0
    exitosas    = 0
    fallidas    = 0

    for id_c, nom_estado in no_vigentes:
        if (carpeta_base / str(id_c)).exists():
            encontradas += 1
            ok = eliminar_archivos_contrato(id_c)
            if ok:
                exitosas += 1
            else:
                fallidas += 1

    log("=" * 60, "INFO")
    if encontradas == 0:
        log("✅ LIMPIEZA COMPLETA: no había carpetas huérfanas de no-vigentes. Todo en orden.", "INFO")
    elif fallidas == 0:
        log(f"✅ LIMPIEZA COMPLETA: {exitosas}/{encontradas} carpetas de no-vigentes eliminadas correctamente.", "INFO")
    else:
        log(f"⚠️ LIMPIEZA CON ERRORES: {exitosas} OK, {fallidas} fallaron de {encontradas} encontradas. Revisa logs arriba.", "WARN")
    log("=" * 60, "INFO")


# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 1 — SELENIUM: LOGIN + T&C + CAPTURA DE TOKEN
# ─────────────────────────────────────────────────────────────────────────────

def esperar_url(driver, fragmentos, timeout=25):
    fin = time.time() + timeout
    while time.time() < fin:
        for frag in fragmentos:
            if frag in driver.current_url:
                return frag
        time.sleep(0.4)
    return None


def expandir_ver_mas(driver, max_intentos=10):
    for _ in range(max_intentos):
        bots = driver.find_elements(By.XPATH, "//button[contains(normalize-space(.), 'Ver más')]")
        if not bots:
            break
        for b in bots:
            try:
                driver.execute_script("arguments[0].click();", b)
                time.sleep(0.15)
            except Exception:
                pass


def forzar_scroll_completo(driver, intentos=6, pausa=0.5):
    prev = -1
    for _ in range(intentos):
        h = driver.execute_script("return document.body.scrollHeight;")
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        driver.execute_script("window.dispatchEvent(new Event('scroll'));")
        time.sleep(pausa)
        if h == prev:
            break
        prev = h
def obtener_tokens_de_storage(driver):
    """Extrae token y refreshToken desde sessionStorage (donde el sitio los guarda)."""
    token = None
    refresh = None
    try:
        raw = driver.execute_script("return JSON.stringify(sessionStorage);")
        data = json.loads(raw or "{}")
        log(f"🔍 Claves en sessionStorage: {list(data.keys())}", "INFO")
        token   = data.get("accessToken")
        refresh = data.get("refreshToken")
        if token:
            log(f"   ✅ accessToken encontrado en sessionStorage", "INFO")
        if refresh:
            log(f"   ✅ refreshToken encontrado en sessionStorage", "INFO")
    except Exception as e:
        log(f"⚠️ Error leyendo sessionStorage: {e}", "WARN")
    return token, refresh

def capturar_tokens_de_logs(driver):
    """Busca token Y refreshToken en logs de red de Chrome."""
    token = None
    refresh = None
    try:
        logs = driver.get_log("performance")
    except Exception:
        return token, refresh

    # Recopilar todos los response bodies de los endpoints de auth
    request_map = {}  # requestId -> url

    for entry in logs:
        try:
            msg = json.loads(entry["message"])["message"]
            method = msg.get("method", "")
            params = msg.get("params", {})

            # Mapear requestId -> url
            if method == "Network.requestWillBeSent":
                req = params.get("request", {})
                req_id = params.get("requestId", "")
                url = req.get("url", "")
                if req_id:
                    request_map[req_id] = url

                # Capturar token desde headers Authorization
                headers = req.get("headers", {})
                for h_key, h_val in headers.items():
                    if h_key.lower() == "authorization" and "Bearer " in str(h_val):
                        token = h_val.replace("Bearer ", "").strip()

                # Capturar refreshToken desde body de requests
                body = req.get("postData", "")
                if body:
                    try:
                        obj = json.loads(body)
                        if isinstance(obj, dict) and "refreshToken" in obj:
                            refresh = obj["refreshToken"]
                    except Exception:
                        pass

            # Capturar token/refreshToken desde body de RESPUESTAS de login/refresh
            elif method == "Network.responseReceived":
                req_id = params.get("requestId", "")
                resp_url = params.get("response", {}).get("url", "")
                # guardar url también desde respuesta
                if req_id and resp_url:
                    request_map[req_id] = resp_url

        except Exception:
            pass

    # Segunda pasada: leer body de respuestas de endpoints de auth
    for entry in logs:
        try:
            msg = json.loads(entry["message"])["message"]
            if msg.get("method") != "Network.loadingFinished":
                continue
            req_id = msg["params"].get("requestId", "")
            url = request_map.get(req_id, "")
            # solo endpoints de login o refresh
            if not any(x in url for x in ("login", "acceder", "autenticar", "tokens", "seguridad", "auth")):
                continue
            try:
                resp = driver.execute_cdp_cmd(
                    "Network.getResponseBody", {"requestId": req_id}
                )
                body_text = resp.get("body", "")
                if not body_text:
                    continue
                obj = json.loads(body_text)
                if isinstance(obj, dict):
                    # token puede llamarse token, accessToken, access_token
                    for campo_tok in ("token", "accessToken", "access_token"):
                        if campo_tok in obj and obj[campo_tok] and len(str(obj[campo_tok])) > 20:
                            token = obj[campo_tok]
                            break
                    # refreshToken
                    for campo_ref in ("refreshToken", "refresh_token", "refresh"):
                        if campo_ref in obj and obj[campo_ref]:
                            refresh = obj[campo_ref]
                            break
                    if token or refresh:
                        log(f"   ✅ Tokens desde response body de: {url[-60:]}", "INFO")
            except Exception:
                pass
        except Exception:
            pass

    return token, refresh

def login_requests(ruc, password):
    """Intenta login directo por POST sin Selenium. Devuelve (token, refresh) o (None, None)."""
    try:
        payload = {
            "username": ruc,
            "password": password,
            "terminal": _ip_terminal,
        }
        headers = {
            "accept"        : "application/json, text/plain, */*",
            "content-type"  : "application/json",
            "cache-control" : "no-cache",
            "pragma"        : "no-cache",
            "origin"        : BASE_URL,
            "referer"       : f"{BASE_URL}/auth-proveedor/",
            "user-agent"    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
        }
        r = requests.post(URL_LOGIN_API, json=payload, headers=headers, timeout=20)
        log(f"   Login API status: {r.status_code}", "INFO")
        if r.status_code == 200:
            data = r.json()
            log(f"   Login API response keys: {list(data.keys())}", "INFO")
            token   = data.get("token") or data.get("accessToken") or data.get("access_token")
            refresh = data.get("refreshToken") or data.get("refresh_token")
            if token:
                log(f"   ✅ Login por requests exitoso", "INFO")
                return token, refresh
        log(f"   Login API falló: {r.text[:200]}", "WARN")
    except Exception as e:
        log(f"   Login API excepción: {e}", "WARN")
    return None, None


async def login_playwright(ruc, password):
    """Login con Playwright (headless) + captura de token vía network + sessionStorage."""
    global _token, _refresh_tok, _ip_terminal

    token_capturado = {"token": None, "refresh": None}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-extensions",
            ],
        )
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        # Bloquea imágenes, fuentes, CSS y video/audio — nada de eso hace falta
        # para que el formulario de login funcione, y es lo que más tiempo
        # tarda en cargar en un sitio con tanto recurso visual. Esto es lo
        # que más va a acelerar el login.
        async def _bloquear_recursos(route):
            if route.request.resource_type in ("image", "font", "stylesheet", "media"):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _bloquear_recursos)

        async def _on_response(response):
            url = response.url
            if not any(x in url for x in ("login", "acceder", "autenticar", "tokens", "seguridad", "auth")):
                return
            try:
                obj = await response.json()
            except Exception:
                return
            if not isinstance(obj, dict):
                return
            for campo_tok in ("token", "accessToken", "access_token"):
                if obj.get(campo_tok) and len(str(obj[campo_tok])) > 20:
                    token_capturado["token"] = obj[campo_tok]
            for campo_ref in ("refreshToken", "refresh_token", "refresh"):
                if obj.get(campo_ref):
                    token_capturado["refresh"] = obj[campo_ref]

        page.on("response", lambda r: asyncio.create_task(_on_response(r)))

        try:
            log("🔑 Abriendo navegador (Playwright) → login...", "INFO")
            await page.goto(URL_LOGIN, wait_until="domcontentloaded", timeout=30000)

            await page.wait_for_selector('input[placeholder="Ingrese su RUC"]', timeout=25000)
            await page.fill('input[placeholder="Ingrese su RUC"]', ruc)
            await page.fill('input[placeholder="******"]', password)
            await page.click("//button[@type='submit' and contains(., 'Acceder')]")

            log("⏳ Esperando redirección post-login...", "INFO")
            try:
                await page.wait_for_url("**terminos-condiciones**", timeout=15000)
                en_tyc = True
            except Exception:
                en_tyc = False

            if en_tyc:
                log("📄 Pantalla de Términos y Condiciones detectada, aceptando...", "INFO")
                for _ in range(10):
                    bots = await page.query_selector_all("//button[contains(normalize-space(.), 'Ver más')]")
                    if not bots:
                        break
                    for b in bots:
                        try:
                            await b.click()
                            await page.wait_for_timeout(150)
                        except Exception:
                            pass

                for _ in range(6):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(400)

                checkbox = await page.wait_for_selector(
                    "input.mdc-checkbox__native-control[type='checkbox']", timeout=15000
                )
                await checkbox.click(force=True)
                await page.wait_for_timeout(400)

                boton_acepto = await page.wait_for_selector(
                    "//button[contains(normalize-space(.), 'Acepto') and not(contains(normalize-space(.), 'No Acepto'))]",
                    timeout=15000
                )
                fin_esp = time.time() + 20
                while time.time() < fin_esp:
                    clases = await boton_acepto.get_attribute("class") or ""
                    if "cursor-not-allowed" not in clases and "bg-disabled" not in clases:
                        break
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(300)

                await boton_acepto.scroll_into_view_if_needed()
                await page.wait_for_timeout(200)
                await boton_acepto.click()
                await page.wait_for_timeout(1500)

            log("✅ Login exitoso. Capturando tokens...", "INFO")

            for intento in range(20):
                await page.wait_for_timeout(300)
                try:
                    raw = await page.evaluate("JSON.stringify(sessionStorage)")
                    data = json.loads(raw or "{}")
                    if data.get("accessToken"):
                        token_capturado["token"] = data["accessToken"]
                    if data.get("refreshToken"):
                        token_capturado["refresh"] = data["refreshToken"]
                except Exception:
                    pass
                if token_capturado["token"] and token_capturado["refresh"]:
                    log(f"   ✅ Ambos tokens capturados en intento {intento+1}", "INFO")
                    break

            token = token_capturado["token"]
            refresh = token_capturado["refresh"]

            if not token:
                log("⚠️ No se encontró token con Playwright.", "WARN")

            log(f"🎫 Token capturado (primeros 40 chars): {(token or '')[:40]}...")
            if refresh:
                log(f"🔄 RefreshToken capturado: {refresh[:20]}...")
            else:
                log("⚠️ RefreshToken NO encontrado.", "WARN")

            return token, refresh

        finally:
            await context.close()
            await browser.close()
            log("🌐 Navegador (Playwright) cerrado.", "INFO")

# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 2 — GESTIÓN DE SESIÓN (requests puro)
# ─────────────────────────────────────────────────────────────────────────────

def _headers_base():
    tok = obtener_token_actual()
    return {
        "accept"          : "application/json, text/plain, */*",
        "accept-language" : "es-ES,es;q=0.9",
        "authorization"   : f"Bearer {tok}",
        "cache-control"   : "no-cache",
        "pragma"          : "no-cache",
        "sec-fetch-dest"  : "empty",
        "sec-fetch-mode"  : "cors",
        "sec-fetch-site"  : "same-origin",
        "user-agent"      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "origin"          : BASE_URL,
        "client-s8uit"    : json.dumps({"terminal": _ip_terminal}),
    }


def refresh_token():
    """Renueva el token JWT usando el refreshToken. Thread-safe."""
    global _token, _refresh_tok
    with _lock_token:
        rt  = _refresh_tok
        usr = _username
        ip  = _ip_terminal

    if not rt:
        log("⚠️ No hay refreshToken disponible.", "WARN")
        return False

    try:
        r = requests.post(
            URL_REFRESH,
            json={"refreshToken": rt, "username": usr},
            headers={
                "accept"       : "application/json, text/plain, */*",
                "content-type" : "application/json",
                "client-s8uit" : json.dumps({"terminal": ip}),
                "cache-control": "no-cache",
                "pragma"       : "no-cache",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
            },
            timeout=15
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("respuesta"):
                with _lock_token:
                    _token       = data["token"]
                    # el refreshToken puede rotar o mantenerse
                    _refresh_tok = data.get("refreshToken", rt)
                _guardar_token_disco()
                _session_estado["activa"] = True
                _session_estado["error"] = None
                log(f"🔄 Token renovado OK (exp en ~5min)")
                return True
        log(f"⚠️ Refresh falló: {r.status_code} {r.text[:120]}", "WARN")
    except Exception as e:
        log(f"⚠️ Refresh error: {e}", "WARN")
    _session_estado["activa"] = False
    _session_estado["error"] = "No se pudo renovar la sesión con SEACE"
    return False


def _get_json(url, params=None, reintentos=3, referer=None):
    """GET con reintentos + refresh automático si 401."""
    headers = _headers_base()
    if referer:
        headers["referer"] = referer

    for intento in range(reintentos):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=120)
            if r.status_code == 401:
                log(f"   401 en {url[:60]} → refreshing token...", "WARN")
                if refresh_token():
                    headers = _headers_base()
                    if referer:
                        headers["referer"] = referer
                    continue
                else:
                    return None
            if r.status_code == 200:
                return r.json()
            log(f"   HTTP {r.status_code} en {url[:60]}", "WARN")
            time.sleep(1)
        except Exception as e:
            log(f"   Error GET {url[:60]}: {e}", "WARN")
            time.sleep(1 + intento)
    return None


def _get_bytes(url, reintentos=3):
    """Descarga binaria con reintentos."""
    headers = _headers_base()
    for intento in range(reintentos):
        try:
            r = requests.get(url, headers=headers, timeout=60)
            if r.status_code == 401:
                refresh_token()
                headers = _headers_base()
                continue
            if r.status_code == 200:
                return r.content, r.headers.get("content-type", "")
        except Exception as e:
            log(f"   Error descarga {url[-30:]}: {e}", "WARN")
            time.sleep(1 + intento)
    return None, None

async def _async_get_bytes(session, url):
    headers = _headers_base()
    for intento in range(3):
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=300)) as r:
                if r.status == 401:
                    refresh_token()
                    headers = _headers_base()
                    continue

                if r.status == 403:
                    log(f"🚫 Archivo bloqueado temporalmente", "WARN")
                    await asyncio.sleep(10)
                    continue
                if r.status == 200:
                    contenido = await r.read()
                    mime = r.headers.get("content-type", "")
                    return contenido, mime
        except Exception as e:
            log(f"   Error async descarga {url[-30:]}: {type(e).__name__}: {e}", "WARN")
            await asyncio.sleep(1 + intento)
    return None, None


async def descargar_archivo_async(session, id_archivo, nombre_archivo, carpeta_destino):
    global _semaforo_descargas
    url = f"{URL_DESCARGA}/{id_archivo}"
    async with _semaforo_descargas:
        await asyncio.sleep(0.2)
        contenido, mime = await _async_get_bytes(session, url)
    if contenido:
        # guardar_bytes_archivo es sync pero rápido; lo llamamos directo desde async
        ruta, size = guardar_bytes_archivo(contenido, carpeta_destino, id_archivo, nombre_archivo)
        if ruta:
            return ruta, size
    log(f"   ⚠️ Fallo descarga archivo id={id_archivo} nombre={nombre_archivo}", "WARN")
    return None, 0

_semaforo_descargas = None  # se inicializa dentro del event loop

async def _async_get_json(session, url, params=None, referer=None, ruc=None):
    """
    Si `ruc` viene dado, usa la sesión de ESA empresa (multiempresa).
    Si `ruc` es None, usa la sesión de la cuenta principal (comportamiento
    original, usado por el scraper masivo).
    """
    headers = _headers_base_empresa(ruc) if ruc else _headers_base()
    if referer:
        headers["referer"] = referer
    for intento in range(5):
        try:
            async with session.get(url, params=params, headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=120)) as r:
                if r.status == 401:
                    log(f"   401 en {url[:60]} → refreshing token (ruc={ruc or RUC})...", "WARN")
                    if ruc:
                        refresh_token_empresa(ruc)
                        headers = _headers_base_empresa(ruc)
                    else:
                        refresh_token()
                        headers = _headers_base()
                    if referer:
                        headers["referer"] = referer
                    await asyncio.sleep(2)
                    continue
                if r.status == 403:
                    log(f"🚫 403 detectado - esperando 10 segundos", "WARN")
                    await asyncio.sleep(10)
                    continue              

                if r.status == 200:
                    return await r.json(content_type=None)
                log(f"   HTTP {r.status} en {url[:60]}", "WARN")
                await asyncio.sleep(2 * (intento + 1))
        except asyncio.TimeoutError:
            log(f"   TIMEOUT intento {intento+1}/5 en {url[:80]}", "WARN")
            await asyncio.sleep(3 * (intento + 1))
        except Exception as e:
            log(f"   Error async GET {url[:60]}: {type(e).__name__}: {e}", "WARN")
            await asyncio.sleep(2 + intento)
    log(f"   ❌ Falló definitivamente: {url[:80]}", "ERROR")
    return None

async def procesar_contrato_async(session, item_lista, semaforo):
    async with semaforo:
        id_contrato   = item_lista["idContrato"]
        estado        = item_lista.get("nomEstadoContrato", "")
        puede_cotizar = item_lista.get("cotizar", False)

        resultado = {
            **item_lista,
            "detalle_contrato"    : None,
            "archivos_contrato"   : [],
            "detalle_cotizacion"  : None,
            "completo_cotizacion" : None,
            "archivos_cotizacion" : [],
            "links_descarga"      : [],
            "archivos_descargados": [],
            "_error"              : None,
        }

        try:
            ref_det = f"{BASE_URL}/cotizacion/contrataciones/contratacion-detalle/{id_contrato}"

            url_arch  = f"{URL_ARCHIVOS}/{id_contrato}/1"
            url_arch2 = f"{URL_ARCHIVOS}/{id_contrato}/2"

            detalle, archivos, archivos2 = await asyncio.gather(
                _async_get_json(session, URL_DETALLE, params={"id_contrato": id_contrato}, referer=ref_det),
                _async_get_json(session, url_arch, referer=ref_det),
                _async_get_json(session, url_arch2, referer=ref_det),
            )
            archivos  = archivos or []
            archivos2 = archivos2 or []

            resultado["detalle_contrato"] = detalle
            todos_archivos = archivos + archivos2
            resultado["archivos_contrato"] = todos_archivos
            archivos = todos_archivos  # para el loop de links que sigue abajo


            links = []
            for arch in archivos:
                id_arch = arch.get("idContratoArchivo")
                if id_arch:
                    links.append({
                        "idArchivo"   : id_arch,
                        "nombre"      : arch.get("nombre", ""),
                        "tipo"        : arch.get("nombreTipoArchivo", ""),
                        "extension"   : arch.get("descripcionExtension", ""),
                        "tamanio"     : arch.get("tamanio", ""),
                        "url_descarga": f"{URL_DESCARGA}/{id_arch}",
                    })
                    if DESCARGAR_ARCHIVOS and estado == "Vigente":
                        carpeta = CARPETA_SALIDA / "archivos" / str(id_contrato)
                        ruta, size = await descargar_archivo_async(session, id_arch, arch.get("nombre", f"{id_arch}"), carpeta)
                        if ruta:
                            resultado["archivos_descargados"].append({
                                "idArchivo": id_arch, "ruta": ruta, "bytes": size
                            })
            resultado["links_descarga"] = links

            if puede_cotizar or estado == "Vigente":
                        log(f"   🟡 [{id_contrato}] Entrando a cotización (cotizar={puede_cotizar}, estado={estado})", "INFO")
                        ref_cot = f"{BASE_URL}/cotizacion/cotizaciones/{id_contrato}/registrar-cotizacion"

                        det_cot, comp_cot = await asyncio.gather(
                            _async_get_json(session, URL_DETALLE_COT, params={"id_contrato": id_contrato}, referer=ref_cot),
                            _async_get_json(session, URL_OBTENER_COT, params={"id_contrato": id_contrato}, referer=ref_cot),
                        )

                        if det_cot:
                            n_items_cot = len(det_cot.get("uitContratoItemCotizacionProjectionList") or [])
                            n_arch_cot_real = len(det_cot.get("contratoArchivoCotizacionProjectionList") or [])
                            log(f"   🟢 [{id_contrato}] detalle_cotizacion OK — {n_items_cot} items, {n_arch_cot_real} archivos cotización", "INFO")
                        else:
                            log(f"   🔴 [{id_contrato}] detalle_cotizacion FALLÓ (None)", "WARN")

                        if comp_cot:
                            log(f"   🟢 [{id_contrato}] completo_cotizacion OK (datos generales del contrato)", "INFO")
                        else:
                            log(f"   🔴 [{id_contrato}] completo_cotizacion FALLÓ (None)", "WARN")

                        resultado["detalle_cotizacion"]  = det_cot
                        resultado["completo_cotizacion"] = comp_cot

                        if det_cot and "contratoArchivoCotizacionProjectionList" in det_cot:
                            arch_list = det_cot["contratoArchivoCotizacionProjectionList"]
                            if arch_list:
                                log(f"   📂 [{id_contrato}] {len(arch_list)} archivos de cotización encontrados — descargando...", "INFO")
                                for arch in arch_list:
                                    id_arch  = arch.get("idContratoArchivo")
                                    nom_arch = arch.get("nombreArchivo") or arch.get("nombre") or f"{id_arch}"
                                    ext_arch = arch.get("desExtension") or arch.get("extension") or ""
                                    tip_arch = arch.get("nomTipoArchivo") or arch.get("tipo") or ""
                                    tam_arch = arch.get("tamanio") or ""
                                    if id_arch:
                                        resultado["links_descarga"].append({
                                            "idArchivo"   : id_arch,
                                            "nombre"      : nom_arch,
                                            "tipo"        : tip_arch,
                                            "extension"   : ext_arch,
                                            "tamanio"     : tam_arch,
                                            "url_descarga": f"{URL_DESCARGA}/{id_arch}",
                                            "contexto"    : "cotizacion",
                                        })
                                        log(f"   📄 [{id_contrato}] arch_cot id={id_arch} nombre={nom_arch} ext={ext_arch} tipo={tip_arch}", "INFO")
                                        if DESCARGAR_ARCHIVOS and estado == "Vigente":
                                            carpeta = CARPETA_SALIDA / "archivos" / str(id_contrato) / "cotizacion"
                                            ruta, size = await descargar_archivo_async(
                                                session, id_arch, nom_arch, carpeta
                                            )
                                            if ruta:
                                                resultado["archivos_descargados"].append({
                                                    "idArchivo": id_arch, "ruta": ruta, "bytes": size
                                                })
                                                log(f"   ✅ [{id_contrato}] Descargado arch_cot: {nom_arch} ({size:,} bytes)", "INFO")
                                            else:
                                                log(f"   ❌ [{id_contrato}] FALLÓ descarga arch_cot id={id_arch} nombre={nom_arch}", "WARN")
                            else:
                                log(f"   ⚪ [{id_contrato}] contratoArchivoCotizacionProjectionList existe pero está VACÍO", "INFO")
                        else:
                            if comp_cot is not None:
                                log(f"   ⚪ [{id_contrato}] Sin clave contratoArchivoCotizacionProjectionList en completo_cotizacion", "INFO")
                            else:
                                log(f"   🔴 [{id_contrato}] comp_cot es None — no se pudieron obtener archivos de cotización", "WARN")

        except Exception as e:
            resultado["_error"] = traceback.format_exc()
            log(f"   ❌ Error en contrato {id_contrato}: {e}", "ERROR")

        return resultado


async def procesar_pagina_async(items, procesados, pg, semaforo_limit, semaforo_descargas=100):
    completados = 0
    errores     = 0
    pendientes = []
    for it in items:    
        id_c        = str(it["idContrato"])
        info_previa = procesados.get(id_c)

        # ── Contrato nuevo: siempre procesar ─────────────────────────────────
        if info_previa is None:
            pendientes.append(it)
            continue

        estado_seace = it.get("nomEstadoContrato", "")
        estado_bd    = info_previa.get("idEstadoContrato", 0)

        # ── Estado cambió en SEACE vs lo que tenemos en BD → reprocesar ──────
        mapa_estado = {"Vigente": 2, "En Evaluación": 3, "Culminado": 4}
        id_estado_seace = mapa_estado.get(estado_seace, 0)
        if id_estado_seace and id_estado_seace != estado_bd:
            log(f"   🔁 [{id_c}] Estado cambió {estado_bd}→{id_estado_seace} ({estado_seace}) → reprocesar")
            pendientes.append(it)
            continue

        # ── Habilitado para cotizar → siempre reprocesar ─────────────────────
        if it.get("cotizar") == True:
            pendientes.append(it)
            continue

        # ── Vigente: reprocesar si no tiene archivos de cotización ────────────
        if (estado_seace == "Vigente"
                and not info_previa.get("tieneArchivosCotizacion", False)):
            pendientes.append(it)
            continue

        # ── En Evaluación: reprocesar si no tiene archivos de cotización ──────
        if (estado_seace == "En Evaluación"
                and not info_previa.get("tieneArchivosCotizacion", False)):
            pendientes.append(it)
            continue

        # ── Culminado: reprocesar si le faltan datos ──────────────────────────
        if estado_seace == "Culminado":
            if not info_previa.get("tieneArchivos", False):
                pendientes.append(it)
                continue
            if not info_previa.get("tieneOfertas", False):
                pendientes.append(it)
                continue
            if info_previa.get("tieneOfertaSinCubso", False):
                pendientes.append(it)
                continue
            if info_previa.get("tieneOfertaSinCantidad", False):
                pendientes.append(it)
                continue

        # ── Si llegó aquí: ya está completo, saltar ───────────────────────────
    if not pendientes:
        log(f"   ✅ Página {pg} ya completada.")
        return 0, 0

    log(f"   🔜 Procesando {len(pendientes)} contratos de página {pg} con asyncio...")

    global _semaforo_descargas
    semaforo = asyncio.Semaphore(semaforo_limit)
    _semaforo_descargas = asyncio.Semaphore(semaforo_descargas)  # reducido para no saturar SEACE
    connector = aiohttp.TCPConnector(
        limit=160,
        limit_per_host=160,
        ssl=False
    )
    async with aiohttp.ClientSession(connector=connector) as session:
        tareas = [
            procesar_contrato_async(session, it, semaforo)
            for it in pendientes
        ]
        for fut in asyncio.as_completed(tareas):
            resultado = await fut
            id_c = str(resultado["idContrato"])
            procesados[id_c] = resultado

            if resultado.get("_error"):
                errores += 1
            else:
                completados += 1

            total = completados + errores
            n_arch = len(resultado.get("links_descarga", []))
            n_arch_contrato  = len([l for l in resultado.get("links_descarga", []) if l.get("contexto","contrato") == "contrato"])
            n_arch_cotizacion = len([l for l in resultado.get("links_descarga", []) if l.get("contexto") == "cotizacion"])
            n_descargados    = len(resultado.get("archivos_descargados", []))
            entro_cot        = resultado.get("detalle_cotizacion") is not None or resultado.get("completo_cotizacion") is not None
            marca_cot        = "🟢COT" if entro_cot else "⚪"
            log(f"   [{total}/{len(pendientes)}] pg{pg} ✅ {id_c} "
                f"({resultado.get('nomEstadoContrato','')}) "
                f"arch_contrato={n_arch_contrato} arch_cot={n_arch_cotizacion} "
                f"descargados={n_descargados} {marca_cot}")

            if total % 100 == 0:
                guardar_json(procesados)
                guardar_excel(procesados)
                log(f"   💾 Guardado incremental: {len(procesados)} en LA BASE DE DATOS.")
    
    return completados, errores


# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 3 — AUTO-REFRESH PERIÓDICO EN BACKGROUND
# ─────────────────────────────────────────────────────────────────────────────

_stop_refresh = threading.Event()

def _auto_refresh_loop(intervalo_seg=180):
    """Cada 3 min verifica si el token está por expirar y hace re-login con Selenium si es necesario."""
    while not _stop_refresh.wait(timeout=intervalo_seg):
        global _token, _refresh_tok
        # Intentar refresh normal primero
        if _refresh_tok:
            log("⏰ Auto-refresh de token...")
            refresh_token()
            continue

        # Sin refreshToken: verificar expiración del JWT
        try:
            partes = _token.split(".")
            if len(partes) >= 2:
                padding = 4 - len(partes[1]) % 4
                payload_bytes = partes[1] + "=" * padding
                import base64
                payload_json = json.loads(base64.b64decode(payload_bytes).decode("utf-8"))
                exp = payload_json.get("exp", 0)
                segundos_restantes = exp - time.time()
                log(f"⏰ Token expira en {int(segundos_restantes)}s", "INFO")
                if segundos_restantes < 240:
                    log("🔄 Token próximo a expirar — haciendo re-login con Selenium...", "INFO")
                    try:
                        tok, ref = asyncio.run(login_playwright(RUC, PASSWORD))
                        _token       = tok
                        _refresh_tok = ref
                        log("✅ Re-login exitoso.", "INFO")
                    except Exception as e:
                        log(f"❌ Re-login falló: {e}", "ERROR")
        except Exception as e:
            log(f"⚠️ No se pudo decodificar JWT: {e}", "WARN")

# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 4 — EXTRACCIÓN DE DATOS
# ─────────────────────────────────────────────────────────────────────────────

def obtener_total_paginas(anio, page_size):
    """Consulta la primera página para saber el total de elementos."""
    params = {
        "anio"                    : anio,
        "ruc"                     : RUC,
        "cotizaciones_enviadas"   : "false",
        "invitaciones_por_cotizar": "false",
        "orden"                   : 2,
        "page"                    : 1,
        "page_size"               : page_size,
    }
    data = _get_json(URL_BUSCADOR, params=params,
                     referer=f"{BASE_URL}/cotizacion/contrataciones")
    if not data:
        return 0, 0
    total   = data["pageable"]["totalElements"]
    paginas = (total + page_size - 1) // page_size
    log(f"📊 Total procesos: {total:,} | Páginas: {paginas} (page_size={page_size})")
    return total, paginas


def obtener_pagina(anio, page, page_size):
    params = {
        "anio"                    : anio,
        "ruc"                     : RUC,
        "cotizaciones_enviadas"   : "false",
        "invitaciones_por_cotizar": "false",
        "orden"                   : 2,
        "page"                    : page,
        "page_size"               : page_size,
    }
    data = _get_json(URL_BUSCADOR, params=params,
                     referer=f"{BASE_URL}/cotizacion/contrataciones")
    if data and "data" in data:
        return data["data"]
    return []


def obtener_detalle_contrato(id_contrato):
    """Llama a listar-completo para el contrato."""
    return _get_json(URL_DETALLE, params={"id_contrato": id_contrato},
                     referer=f"{BASE_URL}/cotizacion/contrataciones/contratacion-detalle/{id_contrato}")


def obtener_detalle_cotizacion(id_contrato):
    """Llama a cotizacion/listar-completo (pantalla de cotizar)."""
    return _get_json(URL_DETALLE_COT, params={"id_contrato": id_contrato},
                     referer=f"{BASE_URL}/cotizacion/cotizaciones/{id_contrato}/registrar-cotizacion")


def obtener_completo_cotizacion(id_contrato):
    """Llama a contratacion/obtener-completo (pantalla de cotizar)."""
    return _get_json(URL_OBTENER_COT, params={"id_contrato": id_contrato},
                     referer=f"{BASE_URL}/cotizacion/cotizaciones/{id_contrato}/registrar-cotizacion")


def obtener_archivos_contrato(id_contrato, tipo=1):
    """Lista los archivos adjuntos del contrato."""
    url = f"{URL_ARCHIVOS}/{id_contrato}/{tipo}"
    return _get_json(url, referer=f"{BASE_URL}/cotizacion/contrataciones/contratacion-detalle/{id_contrato}") or []


def descargar_archivo(id_archivo, nombre_archivo, carpeta_destino):
    """Descarga un archivo y lo guarda según STORAGE_BACKEND."""
    url = f"{URL_DESCARGA}/{id_archivo}"
    contenido, mime = _get_bytes(url)
    if contenido:
        return guardar_bytes_archivo(contenido, carpeta_destino, id_archivo, nombre_archivo)
    return None, 0

def procesar_contrato(item_lista):
    """
    Dado un item del buscador, extrae TODO:
      - info básica del buscador
      - detalle completo
      - archivos + links de descarga
      - si cotizar=True: info de cotización
    Devuelve un dict enriquecido.
    """
    id_contrato  = item_lista["idContrato"]
    estado       = item_lista.get("nomEstadoContrato", "")
    puede_cotizar = item_lista.get("cotizar", False)

    resultado = {
        **item_lista,
        "detalle_contrato"    : None,
        "archivos_contrato"   : [],
        "detalle_cotizacion"  : None,
        "completo_cotizacion" : None,
        "archivos_cotizacion" : [],
        "links_descarga"      : [],
        "archivos_descargados": [],
        "_error"              : None,
    }

    try:
        # ── Detalle del contrato ──────────────────────────────────────────
        detalle = obtener_detalle_contrato(id_contrato)
        resultado["detalle_contrato"] = detalle

        # ── Archivos del contrato (tipo 1) ────────────────────────────────
        archivos  = obtener_archivos_contrato(id_contrato, tipo=1)
        archivos2 = obtener_archivos_contrato(id_contrato, tipo=2)
        archivos  = archivos + archivos2
        resultado["archivos_contrato"] = archivos

        # Construir links de descarga
        links = []
        for arch in archivos:
            id_arch = arch.get("idContratoArchivo")
            if id_arch:
                link = f"{URL_DESCARGA}/{id_arch}"
                links.append({
                    "idArchivo"  : id_arch,
                    "nombre"     : arch.get("nombre", ""),
                    "tipo"       : arch.get("nombreTipoArchivo", ""),
                    "extension"  : arch.get("descripcionExtension", ""),
                    "tamanio"    : arch.get("tamanio", ""),
                    "url_descarga": link,
                })
                # Descarga física
                if DESCARGAR_ARCHIVOS and estado == "Vigente":
                    carpeta = CARPETA_SALIDA / "archivos" / str(id_contrato)
                    ruta, size = descargar_archivo(id_arch, arch.get("nombre", f"{id_arch}"), carpeta)
                    if ruta:
                        resultado["archivos_descargados"].append({
                            "idArchivo": id_arch, "ruta": ruta, "bytes": size
                        })
        resultado["links_descarga"] = links

        # ── Si puede cotizar: info extra de cotización ────────────────────
        if puede_cotizar or estado == "Vigente":
            det_cot  = obtener_detalle_cotizacion(id_contrato)
            comp_cot = obtener_completo_cotizacion(id_contrato)
            resultado["detalle_cotizacion"]  = det_cot
            resultado["completo_cotizacion"] = comp_cot

            # Archivos de cotización (dentro de obtener-completo)
            if comp_cot and "contratoArchivoCotizacionProjectionList" in comp_cot:
                arch_cot = comp_cot["contratoArchivoCotizacionProjectionList"]
                for arch in arch_cot:
                    id_arch = arch.get("idContratoArchivo")
                    if id_arch:
                        link = f"{URL_DESCARGA}/{id_arch}"
                        resultado["links_descarga"].append({
                            "idArchivo"  : id_arch,
                            "nombre"     : arch.get("nombreArchivo", ""),
                            "tipo"       : arch.get("nomTipoArchivo", ""),
                            "extension"  : arch.get("desExtension", ""),
                            "tamanio"    : arch.get("tamanio", ""),
                            "url_descarga": link,
                            "contexto"   : "cotizacion",
                        })
                        if DESCARGAR_ARCHIVOS and estado == "Vigente":
                            carpeta = CARPETA_SALIDA / "archivos" / str(id_contrato) / "cotizacion"
                            ruta, size = descargar_archivo(
                                id_arch, arch.get("nombreArchivo", f"{id_arch}"), carpeta
                            )
                            if ruta:
                                resultado["archivos_descargados"].append({
                                    "idArchivo": id_arch, "ruta": ruta, "bytes": size
                                })

    except Exception as e:
        resultado["_error"] = traceback.format_exc()
        log(f"   ❌ Error en contrato {id_contrato}: {e}", "ERROR")

    return resultado


# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 5 — GUARDADO EN BASE DE DATOS
# ─────────────────────────────────────────────────────────────────────────────

_save_lock = threading.Lock()

def cargar_json_existente():
    try:
        conn = _get_conn()
        cur  = conn.cursor()
        cur.execute("""
            SELECT c.id_contrato, c.cotizar, c.id_estado_contrato,
                COALESCE(ac.n_arch_cot, 0)   AS n_arch_cot,
                COALESCE(at.n_arch, 0)        AS n_arch,
                COALESCE(od.n_sin_cubso, 0)   AS n_sin_cubso,
                COALESCE(ot.n_ofertas, 0)     AS n_ofertas,
                COALESCE(oq.n_sin_cant, 0)    AS n_sin_cant
            FROM contratos c
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_arch_cot
                FROM archivos
                WHERE contexto = 'cotizacion'
                GROUP BY id_contrato
            ) ac ON ac.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_arch
                FROM archivos
                GROUP BY id_contrato
            ) at ON at.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_sin_cubso
                FROM cotizacion_ofertas
                WHERE cod_cubso IS NULL
                GROUP BY id_contrato
            ) od ON od.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_ofertas
                FROM cotizacion_ofertas
                GROUP BY id_contrato
            ) ot ON ot.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_sin_cant
                FROM cotizacion_ofertas
                WHERE cantidad IS NULL
                GROUP BY id_contrato
            ) oq ON oq.id_contrato = c.id_contrato
        """)
        rows = cur.fetchall()
        resultado = {
            str(row[0]): {
                "idContrato"              : row[0],
                "cotizar"                 : bool(row[1]),
                "idEstadoContrato"        : row[2],
                "tieneArchivosCotizacion" : row[3] > 0,
                "tieneArchivos"           : row[4] > 0,
                "tieneOfertaSinCubso"     : row[5] > 0,
                "tieneOfertas"            : row[6] > 0,
                "tieneOfertaSinCantidad"  : row[7] > 0,
            }
            for row in rows
        }
        log(f"📂 Contratos ya en BD: {len(resultado)}")
        return resultado
    except Exception as e:
        log(f"⚠️ No se pudo leer BD: {e}", "WARN")
        return {}

def guardar_json(procesados_dict):
    """Guarda en BD todos los contratos del dict."""
    for item in procesados_dict.values():
        if isinstance(item, dict) and item.get("detalle_contrato") is not None:
            guardar_contrato_db(item)

def guardar_excel(procesados_dict):
    """No-op: ya no usamos Excel."""
    pass

def guardar_contrato_db(item):
    id_contrato  = item["idContrato"]
    detalle      = item.get("detalle_contrato") or {}
    det_comp     = detalle.get("uitContratoCompletoProjection") or {}
    etapas       = detalle.get("uitContratoEtapaProjectionList") or []
    items_c      = detalle.get("uitContratoItemProjectionList") or []
    rtms         = detalle.get("uitContratoRtmProjectionList") or []
    proyectos    = detalle.get("uitContratoProyectoProjectionList") or []
    cot_ofertas  = detalle.get("uitCotizacionProjectionList") or []

    det_cot      = item.get("detalle_cotizacion") or {}
    items_cot    = det_cot.get("uitContratoItemCotizacionProjectionList") or []
    rtms_cot     = det_cot.get("uitContratoRtmCotizacionProjectionList") or []

    comp_cot     = item.get("completo_cotizacion") or {}
    links        = item.get("links_descarga") or []
    descargados  = item.get("archivos_descargados") or []
    error        = item.get("_error")

    mapa_rutas = {str(a["idArchivo"]): a for a in descargados}

    try:
        conn = _get_conn()
        cur  = conn.cursor()

        cur.execute("""
            INSERT INTO contratos (
                id_contrato, secuencia, nro_contratacion, des_contratacion,
                id_objeto_contrato, nom_objeto_contrato, des_objeto_contrato,
                nom_etapa_contratacion, fec_ini_cotizacion, fec_fin_cotizacion,
                cotizar, id_estado_contrato, nom_estado_contrato, fec_publica,
                id_tipo_cotizacion, id_cotizacion, id_estado_cotiza, nom_estado_cotiza,
                nom_entidad, num_subsanaciones_total, num_subsanaciones_pend,
                fec_limite_subsana_max,
                id_sigla, nom_sigla, dir_organismo, id_area_usuaria, nom_area_usuaria,
                id_tipo_invitacion, nom_tipo_invitacion, nro_correlativo, nro_descripcion,
                anio, cod_tiene_proy, nro_ccmn, des_ccmn, des_justif_tip_invit,
                id_entidad, abrir_cotizacion, ingresar_inv_proveedor,
                id_tipo_cotizacion_det, nom_tipo_cotizacion, valor_max_uit,
                num_consultas, num_invitaciones, nom_usu_registro,
                nom_sigla_cot, nom_area_usuaria_cot,
                raw_detalle, raw_completo_cotizacion
            ) VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON DUPLICATE KEY UPDATE
                nom_estado_contrato=VALUES(nom_estado_contrato),
                cotizar=VALUES(cotizar),
                nom_sigla_cot=VALUES(nom_sigla_cot),
                nom_area_usuaria_cot=VALUES(nom_area_usuaria_cot),
                raw_detalle=VALUES(raw_detalle),
                raw_completo_cotizacion=VALUES(raw_completo_cotizacion),
                updated_at=CURRENT_TIMESTAMP
        """, (
            id_contrato,
            item.get("secuencia"),
            item.get("nroContratacion"),
            item.get("desContratacion"),
            item.get("idObjetoContrato"),
            item.get("nomObjetoContrato"),
            item.get("desObjetoContrato"),
            item.get("nomEtapaContratacion"),
            item.get("fecIniCotizacion"),
            item.get("fecFinCotizacion"),
            1 if item.get("cotizar") else 0,
            item.get("idEstadoContrato"),
            item.get("nomEstadoContrato"),
            item.get("fecPublica"),
            item.get("idTipoCotizacion"),
            item.get("idCotizacion"),
            item.get("idEstadoCotiza"),
            item.get("nomEstadoCotiza"),
            item.get("nomEntidad"),
            item.get("numSubsanacionesTotal", 0),
            item.get("numSubsanacionesPendientes", 0),
            item.get("fecLimiteSubsanaMax"),
            det_comp.get("idSigla"),
            det_comp.get("nomSigla"),
            det_comp.get("dirOrganismo"),
            det_comp.get("idAreaUsuaria"),
            det_comp.get("nomAreaUsuaria"),
            det_comp.get("idTipoInvitacion"),
            det_comp.get("nomTipoInvitacion"),
            det_comp.get("nroCorrelativo"),
            det_comp.get("nroDescripcion"),
            det_comp.get("anio"),
            det_comp.get("codTieneProy"),
            det_comp.get("nroCcmn"),
            det_comp.get("desCcmn"),
            det_comp.get("desJustifTipInvit"),
            det_comp.get("idEntidad"),
            det_comp.get("abrirCotizacion"),
            det_comp.get("ingresarInvProveedor"),
            det_comp.get("idTipoCotizacion"),
            det_comp.get("nomTipoCotizacion"),
            det_comp.get("valorMaxUit"),
            det_comp.get("numConsultas", 0),
            det_comp.get("numInvitaciones", 0),
            det_comp.get("nomUsuRegistro"),
            comp_cot.get("nomSigla"),
            comp_cot.get("nomAreaUsuaria"),
            json.dumps(detalle, ensure_ascii=False, default=str)[:65000],
            json.dumps(comp_cot, ensure_ascii=False, default=str)[:65000],
        ))

        for tabla in ["contrato_etapas", "contrato_items", "contrato_rtm",
                      "contrato_proyectos", "cotizacion_ofertas",
                      "cotizacion_items", "cotizacion_rtm"]:
            cur.execute(f"DELETE FROM {tabla} WHERE id_contrato=%s", (id_contrato,))

        # NO borrar TODOS los archivos de golpe. Solo borrar el contexto
        # que realmente trajimos datos frescos en ESTA corrida:
        #  - 'contrato' se borra/reinserta solo si 'detalle' vino con datos
        #  - 'cotizacion' se borra/reinserta solo si 'comp_cot' trajo la lista
        # Así, si en esta corrida la cotización todavía no estaba habilitada
        # (comp_cot vacío/None), NO se pierden archivos de cotización que
        # ya existían de una corrida anterior, y viceversa.
        if detalle:
            cur.execute(
                "DELETE FROM archivos WHERE id_contrato=%s AND contexto='contrato'",
                (id_contrato,)
            )
        if comp_cot and "contratoArchivoCotizacionProjectionList" in comp_cot:
            cur.execute(
                "DELETE FROM archivos WHERE id_contrato=%s AND contexto='cotizacion'",
                (id_contrato,)
            )

        for e in etapas:
            cur.execute("""
                INSERT INTO contrato_etapas
                (id_contrato, id_contrato_etapa, id_etapa_contrato,
                 nom_etapa_contrato, fec_ini, fec_fin, des_justif, usu_auditoria)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (id_contrato, e.get("idContratoEtapa"), e.get("idEtapaContrato"),
                  e.get("nomEtapaContrato"), e.get("fecIni"), e.get("fecFin"),
                  e.get("desJustif"), e.get("usuAuditoria")))

        for it in items_c:
            cur.execute("""
                INSERT INTO contrato_items
                (id_contrato, id_contrato_item, id_cubso, cod_cubso, nom_cubso,
                 nom_moneda, id_unidad_medida, nom_unidad_medida,
                 id_distrito, nom_distrito, ubigeo, nom_distrito_ext,
                 descripcion_item, cantidad, precio_total, nom_estado_cotiza)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (id_contrato, it.get("idContratoItem"), it.get("idCubso"),
                  it.get("codCubso"), it.get("nomCubso"), it.get("nomMoneda"),
                  it.get("idUnidadMedida"), it.get("nomUnidadMedida"),
                  it.get("idDistrito"), it.get("nomDistrito"), it.get("ubigeo"),
                  it.get("nomDistritoExt"), it.get("descripcionItem"),
                  it.get("cantidad"), it.get("precioTotal"), it.get("nomEstadoCotiza")))

        for r in rtms:
            cur.execute("""
                INSERT INTO contrato_rtm
                (id_contrato, id_contrato_rtm, nombre_rtm, valor, flg_asigna_valor, flg_base)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (id_contrato, r.get("idContratoRtm"), r.get("nombreRtm"),
                  r.get("valor"), r.get("flgAsignaValor"), r.get("flgBase")))

        for p in proyectos:
            cur.execute("""
                INSERT INTO contrato_proyectos
                (id_contrato, id_contrato_proyecto, cod_proyecto, nom_proyecto)
                VALUES (%s,%s,%s,%s)
            """, (id_contrato, p.get("idContratoProyecto"),
                  p.get("codProyecto"), p.get("nomProyecto")))

        mapa_items_c = {it.get("codCubso"): it for it in items_c if it.get("codCubso")}

        for o in cot_ofertas:
            it_ref = mapa_items_c.get(o.get("codCubso")) or {}
            cur.execute("""
                INSERT INTO cotizacion_ofertas
                (id_contrato, id_cotizacion, id_estado_cotiza, nom_estado_cotiza,
                 cod_ruc, nom_razon_social, precio_oferta, precio_total,
                 plazo_ejecucion, fec_cotiza, id_cubso, cod_cubso,
                 cantidad, nom_cubso, descripcion_item, nom_unidad_medida)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (id_contrato, o.get("idCotizacion"), o.get("idEstadoCotiza"),
                  o.get("nomEstadoCotiza"), o.get("codRuc"), o.get("nomRazonSocial"),
                  o.get("precioOferta"), o.get("precioTotal"), o.get("plazoEjecucion"),
                  o.get("fecCotiza"), o.get("idCubso"), o.get("codCubso"),
                  it_ref.get("cantidad"), it_ref.get("nomCubso"),
                  it_ref.get("descripcionItem"), it_ref.get("nomUnidadMedida")))

        if not cot_ofertas and items_c:
            for it in items_c:
                if it.get("nomEstadoCotiza"):
                    cur.execute("""
                        INSERT INTO cotizacion_ofertas
                        (id_contrato, id_cotizacion, id_estado_cotiza, nom_estado_cotiza,
                         cod_ruc, nom_razon_social, precio_oferta, precio_total,
                         plazo_ejecucion, fec_cotiza, id_cubso, cod_cubso,
                         cantidad, nom_cubso, descripcion_item, nom_unidad_medida)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (id_contrato, None, None,
                          it.get("nomEstadoCotiza"),
                          None, None, None, it.get("precioTotal"),
                          None, None,
                          it.get("idCubso"), it.get("codCubso"),
                          it.get("cantidad"), it.get("nomCubso"),
                          it.get("descripcionItem"), it.get("nomUnidadMedida")))

        for ic in items_cot:
            cur.execute("""
                INSERT INTO cotizacion_items
                (id_contrato, id_contrato_item, id_cubso, cod_cubso, nom_cubso,
                 nom_moneda, nom_unidad_medida, descripcion_item,
                 cantidad, precio_unitario, precio_total)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (id_contrato, ic.get("idContratoItem"), ic.get("idCubso"),
                  ic.get("codCubso"), ic.get("nomCubso"), ic.get("nomMoneda"),
                  ic.get("nomUnidadMedida"), ic.get("descripcionItem"),
                  ic.get("cantidad"), ic.get("precioUnitario"), ic.get("precioTotal")))

        for rc in rtms_cot:
            cur.execute("""
                INSERT INTO cotizacion_rtm
                (id_contrato, id_contrato_rtm, nom_rtm, valor_con_rtm, valor_cot_rtm)
                VALUES (%s,%s,%s,%s,%s)
            """, (id_contrato, rc.get("idContratoRtm"), rc.get("nomRtm"),
                  rc.get("valorConRtm"), rc.get("valorCotRtm")))

        for link in links:
            id_arch    = link.get("idArchivo")
            info_desc  = mapa_rutas.get(str(id_arch), {})
            ruta_local = info_desc.get("ruta", "")
            if ruta_local:
                try:
                    ruta_local = str(Path(ruta_local).relative_to(CARPETA_SALIDA))
                except ValueError:
                    ruta_local = str(Path(ruta_local).resolve())
            contexto_arch = link.get("contexto") or "contrato"
            cur.execute("""
                INSERT INTO archivos
                (id_contrato, id_archivo, nombre, tipo, extension,
                 tamanio, url_descarga, ruta_local, contexto, bytes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    ruta_local=VALUES(ruta_local),
                    contexto=VALUES(contexto),
                    bytes=VALUES(bytes)
            """, (id_contrato, id_arch, link.get("nombre"), link.get("tipo"),
                  link.get("extension"), str(link.get("tamanio", "")),
                  link.get("url_descarga"), ruta_local,
                  contexto_arch, info_desc.get("bytes", 0)))

        if error:
            cur.execute("""
                INSERT INTO errores (id_contrato, error) VALUES (%s,%s)
                ON DUPLICATE KEY UPDATE error=VALUES(error)
            """, (id_contrato, str(error)[:65000]))

        conn.commit()
        cur.close()
        conn.close()

    except Exception as e:
        log(f"   ❌ DB error contrato {id_contrato}: {e}", "ERROR")
        try:
            conn.rollback()
            cur.close()
            conn.close()
        except:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# BLOQUE 6 — MAIN
# ─────────────────────────────────────────────────────────────────────────────
def enviar_email(total, exitosos, errores, modo):
    try:
        asunto = f"PLADIBOT te informa: extracción {modo.upper()} finalizada ({total} contratos)"
        cuerpo = f"""
PLADIBOT TE INFORMA

El proceso de extracción de SEACE ha finalizado correctamente.

RESUMEN DEL PROCESO
--------------------------------------------------
Modo de extracción   : {modo.upper()}
Total procesados     : {total}
Exitosos             : {exitosos}
Errores              : {errores}
Fecha y hora         : {datetime.now().strftime("%d/%m/%Y %H:%M:%S")}
--------------------------------------------------

Los datos ya están disponibles en la base de datos MySQL.

Este es un mensaje automático generado por PLADIBOT.
Grupo Ecolimp E.I.R.L / Multilimp S.A.C. / Ecolimp Empresarial E.I.R.L
        """.strip()

        msg = MIMEMultipart()
        # IMPORTANTE: el From debe ser EXACTAMENTE el correo que hace login,
        # sin nombre bonito delante — eso es lo que más dispara el spam.
        msg["From"]    = EMAIL_REMITENTE
        msg["To"]      = ", ".join(EMAILS_DESTINO)
        msg["Subject"] = asunto
        msg["Reply-To"] = EMAIL_REMITENTE
        msg.attach(MIMEText(cuerpo, "plain", "utf-8"))

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_REMITENTE, EMAIL_PASSWORD)
            server.sendmail(EMAIL_REMITENTE, EMAILS_DESTINO, msg.as_string())

        log(f"📧 Email enviado a: {EMAILS_DESTINO}")
    except Exception as e:
        log(f"⚠️ Error enviando email: {e}", "WARN")


def obtener_pagina(anio, page, page_size, solo_vigentes=False):
    params = {
        "anio"                    : anio,
        "ruc"                     : RUC,
        "cotizaciones_enviadas"   : "false",
        "invitaciones_por_cotizar": "false",
        "orden"                   : 2,
        "page"                    : page,
        "page_size"               : page_size,
    }
    if solo_vigentes:
        params["lista_estado_contrato"] = 2
    data = _get_json(URL_BUSCADOR, params=params,
                     referer=f"{BASE_URL}/cotizacion/contrataciones")
    if data and "data" in data:
        return data["data"]
    return []


def obtener_total_paginas(anio, page_size, solo_vigentes=False):
    params = {
        "anio"                    : anio,
        "ruc"                     : RUC,
        "cotizaciones_enviadas"   : "false",
        "invitaciones_por_cotizar": "false",
        "orden"                   : 2,
        "page"                    : 1,
        "page_size"               : page_size,
    }
    if solo_vigentes:
        params["lista_estado_contrato"] = 2
    data = _get_json(URL_BUSCADOR, params=params,
                     referer=f"{BASE_URL}/cotizacion/contrataciones")
    if not data:
        return 0, 0
    total   = data["pageable"]["totalElements"]
    paginas = (total + page_size - 1) // page_size
    log(f"📊 Total procesos: {total:,} | Páginas: {paginas} (page_size={page_size})")
    return total, paginas

async def _ejecutar_scraper(solo_vigentes=False):
    global _token, _refresh_tok
    _tarea_activa["corriendo"] = True
    _tarea_activa["modo"]      = "vigentes" if solo_vigentes else "todo"
    try:
        log("=" * 60)
        modo_txt = "SOLO VIGENTES + SYNC ESTADOS" if solo_vigentes else "TODOS"
        log(f"   SEACE SCRAPER — {modo_txt} — prod6.seace.gob.pe")
        log("=" * 60)

        _init_pool()
        log("🗄️ Pool de base de datos iniciado.")
        limpiar_archivos_no_vigentes()

        token, refresh = await login_playwright(RUC, PASSWORD)
        _token       = token
        _refresh_tok = refresh
        if token:
            _session_estado["activa"] = True
            _session_estado["conectado_en"] = datetime.now().isoformat()
            _session_estado["error"] = None

        hilo_refresh = threading.Thread(
            target=_auto_refresh_loop, args=(180,), daemon=True
        )
        hilo_refresh.start()
        log("⏰ Auto-refresh iniciado.")

        procesados        = cargar_json_existente()
        SEMAFORO_LIMIT    = 140
        SEMAFORO_DESCARGAS = 40
        completados_total = 0
        errores_total     = 0

        # ── FASE 1: Si es modo vigentes, primero sync rápido de estados ──────
        # Esto actualiza en BD los contratos que pasaron de Vigente→Evaluación
        # o de Evaluación→Culminado, sin necesidad de re-extraer detalle.
        # Solo consulta el buscador SIN filtro de estado (trae los 3 estados)
        # y hace UPDATE masivo en BD. Velocidad: ~3-5 min para 3000 contratos.
        # ── FASE 1: Sync rápido de estados (siempre, no solo en vigentes) ────
        if True:
            log("🔄 FASE 1: Sync rápido de estados (Vigente/Evaluación/Culminado)...")
            try:
                # Traer contratos que en BD están en Vigente (2) o Evaluación (3)
                # porque solo esos pueden cambiar. Culminados (4) ya no cambian.
                conn_sync = _get_conn()
                cur_sync  = conn_sync.cursor()
                cur_sync.execute("""
                    SELECT id_contrato, des_contratacion, id_estado_contrato
                    FROM contratos
                    WHERE id_estado_contrato IN (2, 3)
                """)
                contratos_activos = cur_sync.fetchall()
                cur_sync.close()
                conn_sync.close()
                log(f"   📋 {len(contratos_activos)} contratos activos (Vigente/Evaluación) para verificar")

                # Buscar cada uno por palabra clave (des_contratacion)
                # en lotes de 1 para no sobrecargar, pero usando asyncio concurrente
                cambios_estado = 0

                async def _verificar_estado_contrato(session, id_c, des_c, estado_actual):
                    """Busca el contrato por palabra clave y devuelve el estado actual en SEACE."""
                    params = {
                        "anio"                    : ANIO,
                        "ruc"                     : RUC,
                        "cotizaciones_enviadas"   : "false",
                        "invitaciones_por_cotizar": "false",
                        "palabra_clave"           : des_c,
                        "orden"                   : 2,
                        "page"                    : 1,
                        "page_size"               : 5,
                    }
                    data = await _async_get_json(
                        session, URL_BUSCADOR, params=params,
                        referer=f"{BASE_URL}/cotizacion/contrataciones"
                    )
                    if not data or "data" not in data:
                        return None
                    for item in data["data"]:
                        if item.get("idContrato") == id_c:
                            return item
                    return None

                sem_sync = asyncio.Semaphore(50)  # 30 concurrent, no saturar SEACE

                async def _sync_uno(session, row):
                    nonlocal cambios_estado
                    id_c, des_c, estado_actual = row
                    if not des_c:
                        return
                    async with sem_sync:
                        item_seace = await _verificar_estado_contrato(session, id_c, des_c, estado_actual)
                    if not item_seace:
                        return
                    nuevo_estado  = item_seace.get("idEstadoContrato")
                    nom_nuevo     = item_seace.get("nomEstadoContrato", "")
                    cotizar_nuevo = 1 if item_seace.get("cotizar") else 0

                    if nuevo_estado != estado_actual:
                        try:
                            conn2 = _get_conn()
                            cur2  = conn2.cursor()
                            cur2.execute("""
                                UPDATE contratos
                                SET id_estado_contrato  = %s,
                                    nom_estado_contrato = %s,
                                    cotizar             = %s,
                                    updated_at          = CURRENT_TIMESTAMP
                                WHERE id_contrato = %s
                            """, (nuevo_estado, nom_nuevo, cotizar_nuevo, id_c))
                            conn2.commit()
                            cur2.close()
                            conn2.close()
                            cambios_estado += 1
                            log(f"   🔁 [{id_c}] {des_c[:40]} → {nom_nuevo} (antes: estado {estado_actual})")

                            # Dejó de ser Vigente (pasó a Evaluación o Culminado) → borrar sus archivos
                            if nuevo_estado != 2:
                                log(f"   🔻 [{id_c}] Ya no es Vigente → eliminando archivos...", "INFO")
                                eliminar_archivos_contrato(id_c)
                        except Exception as e:
                            log(f"   ❌ DB sync error {id_c}: {e}", "ERROR")

                        # Si pasó a CULMINADO → extraer detalle completo con resultados
                        if nuevo_estado == 4:
                            log(f"   🏁 [{id_c}] Culminado → extrayendo resultados...")
                            try:
                                detalle_nuevo = _get_json(
                                    URL_DETALLE,
                                    params={"id_contrato": id_c},
                                    referer=f"{BASE_URL}/cotizacion/contrataciones/contratacion-detalle/{id_c}"
                                )
                                if detalle_nuevo:
                                    item_full = {**item_seace, "detalle_contrato": detalle_nuevo,
                                                 "archivos_contrato": [], "detalle_cotizacion": None,
                                                 "completo_cotizacion": None, "archivos_cotizacion": [],
                                                 "links_descarga": [], "archivos_descargados": [], "_error": None}
                                    guardar_contrato_db(item_full)
                                    log(f"   ✅ [{id_c}] Resultados de culminado guardados")

                                    # ── Alerta en tiempo real: ¿ganó alguna de NUESTRAS empresas? ──
                                    # Se revisa aquí, y solo aquí, porque este bloque solo se
                                    # ejecuta cuando el estado ACABA de cambiar a Culminado
                                    # (guardia "nuevo_estado != estado_actual" más arriba), así
                                    # que la alerta se dispara una sola vez por contrato.
                                    ofertas = detalle_nuevo.get("uitCotizacionProjectionList") or []
                                    rucs_propios = set(EMPRESAS.keys())
                                    for oferta in ofertas:
                                        if (oferta.get("nomEstadoCotiza") == "ADJUDICADO"
                                                and oferta.get("codRuc") in rucs_propios):
                                            razon_ganadora = EMPRESAS[oferta["codRuc"]]["razon_social"]
                                            log(f"   🏆 [{id_c}] GANADO por {razon_ganadora}", "INFO")
                                            try:
                                                from socket_manager import notificar_resultado_ganado
                                                await notificar_resultado_ganado(
                                                    id_contrato=id_c,
                                                    razon_social=razon_ganadora,
                                                    des_contratacion=des_c,
                                                    nom_entidad=item_seace.get("nomEntidad"),
                                                )
                                            except Exception as e_sock:
                                                log(f"   ⚠️ No se pudo emitir alerta de ganado: {e_sock}", "WARN")
                                            break
                            except Exception as e:
                                log(f"   ⚠️ [{id_c}] Error extrayendo culminado: {e}", "WARN")

                connector_sync = aiohttp.TCPConnector(limit=60, limit_per_host=60, ssl=False)
                async with aiohttp.ClientSession(connector=connector_sync) as session_sync:
                    tareas_sync = [_sync_uno(session_sync, row) for row in contratos_activos]
                    await asyncio.gather(*tareas_sync)

                log(f"   ✅ FASE 1 completa — {cambios_estado} contratos cambiaron de estado")

            except Exception as e:
                log(f"   ⚠️ Error en FASE 1 sync estados: {e}", "WARN")

        # ── FASE 2: Extracción normal (vigentes o todos) ──────────────────────
        log(f"🔄 FASE 2: Extracción {'VIGENTES' if solo_vigentes else 'TODOS'}...")
        total_elem, total_pags = obtener_total_paginas(ANIO, PAGE_SIZE, solo_vigentes)
        if total_elem == 0:
            log("❌ No se pudieron obtener datos.", "ERROR")
            return

        for pg in range(1, total_pags + 1):
            t0    = time.time()
            items = obtener_pagina(ANIO, pg, PAGE_SIZE, solo_vigentes)
            dt    = time.time() - t0
            log(f"📄 Página {pg}/{total_pags} — {len(items)} items — {dt:.1f}s")

            comp, err = await procesar_pagina_async(items, procesados, pg, SEMAFORO_LIMIT, SEMAFORO_DESCARGAS)
            completados_total += comp
            errores_total     += err

            guardar_json(procesados)
            log(f"   💾 Página {pg} completa — ✅ {comp} | ❌ {err} | Total: {len(procesados)}")
            await asyncio.sleep(0.1)

        guardar_json(procesados)
        log("=" * 60)
        log(f"🏁 FINALIZADO — Total: {len(procesados)} | ✅ {completados_total} | ❌ {errores_total}")
        log("=" * 60)

        enviar_email(len(procesados), completados_total, errores_total,
                     _tarea_activa["modo"])
    except Exception as e:
        log(f"❌ Error fatal en scraper: {e}", "ERROR")
    finally:
        _stop_refresh.set()
        _tarea_activa["corriendo"] = False



async def _vincular_sesion_async():
    global _token, _refresh_tok
    _session_estado["error"] = None
    try:
        _init_pool()
        token, refresh = await login_playwright(RUC, PASSWORD)
        _token       = token
        _refresh_tok = refresh
        if token:
            _guardar_token_disco()
            _session_estado["activa"] = True
            _session_estado["conectado_en"] = datetime.now().isoformat()
            ya_corriendo = any(t.name == "auto_refresh_seace" for t in threading.enumerate())
            if not ya_corriendo:
                hilo_refresh = threading.Thread(
                    target=_auto_refresh_loop, args=(180,), daemon=True, name="auto_refresh_seace"
                )
                hilo_refresh.start()
                log("⏰ Auto-refresh iniciado (vinculación manual).")
        else:
            _session_estado["activa"] = False
            _session_estado["error"] = "No se pudo obtener el token de sesión"
    except Exception as e:
        _session_estado["activa"] = False
        _session_estado["error"] = str(e)
        log(f"❌ Error vinculando sesión: {e}", "ERROR")

# ─── FASTAPI ENDPOINTS ────────────────────────────────────────────────────────

@app.get("/", summary="Estado del scraper")
def estado():
    return {
        "status" : "activo",
        "corriendo": _tarea_activa["corriendo"],
        "modo"   : _tarea_activa["modo"],
    }


@app.get("/health", summary="Healthcheck")
def health():
    return {"status": "ok"}

@app.post("/extraer/todo", summary="Extrae TODOS los contratos del año")
async def extraer_todo(background_tasks: BackgroundTasks, usuario: dict = Depends(requiere_modulo("extraer_todo"))):
    if _tarea_activa["corriendo"]:
        return JSONResponse(
            status_code=409,
            content={"error": "Ya hay una tarea corriendo", "modo": _tarea_activa["modo"]}
        )
    background_tasks.add_task(_ejecutar_scraper, solo_vigentes=False)
    return {"mensaje": "Extracción TOTAL iniciada en background", "modo": "todo"}

@app.post("/extraer/vigentes", summary="Extrae solo contratos VIGENTES")
async def extraer_vigentes(background_tasks: BackgroundTasks, usuario: dict = Depends(requiere_modulo("extraer_vigentes"))):
    if _tarea_activa["corriendo"]:
        return JSONResponse(
            status_code=409,
            content={"error": "Ya hay una tarea corriendo", "modo": _tarea_activa["modo"]}
        )
    background_tasks.add_task(_ejecutar_scraper, solo_vigentes=True)
    return {"mensaje": "Extracción VIGENTES iniciada en background", "modo": "vigentes"}


@app.post("/extraer/reset", summary="Resetea el flag si el scraper quedó colgado")
async def reset_flag(usuario: dict = Depends(requiere_rol("admin"))):
    _tarea_activa["corriendo"] = False
    _tarea_activa["modo"]      = None
    return {"mensaje": "Flag reseteado OK"}



@app.get("/session/estado", summary="Estado de la sesión con SEACE (cuenta principal)")
def session_estado():
    return {
        "activa"      : _session_estado["activa"],
        "conectado_en": _session_estado["conectado_en"],
        "error"       : _session_estado["error"],
    }


@app.post("/session/vincular", summary="Vincula (login) la sesión con SEACE (cuenta principal)")
async def session_vincular(background_tasks: BackgroundTasks, usuario: dict = Depends(requiere_rol("admin"))):
    if _tarea_activa["corriendo"]:
        return JSONResponse(
            status_code=409,
            content={"error": "Ya hay una tarea corriendo", "modo": _tarea_activa["modo"]}
        )
    background_tasks.add_task(_vincular_sesion_async)
    return {"mensaje": "Vinculación de sesión iniciada"}


# ─── ENDPOINTS MULTIEMPRESA (flujo de cotizaciones) ──────────────────────────
@app.get("/session/empresas", summary="Lista empresas con su estado de sesión")
def session_empresas(usuario: dict = Depends(get_current_user)):
    with _lock_sesiones:
        empresas = []
        for ruc in EMPRESAS:
            if ruc == RUC:
                empresas.append({
                    "ruc": ruc,
                    "razon_social": EMPRESAS[ruc]["razon_social"],
                    "activa": _session_estado["activa"],
                    "conectado_en": _session_estado["conectado_en"],
                    "error": _session_estado["error"],
                    "seleccionada": ruc == _empresa_seleccionada,
                })
            else:
                empresas.append({
                    "ruc": ruc,
                    "razon_social": EMPRESAS[ruc]["razon_social"],
                    "activa": _sesiones[ruc]["activa"],
                    "conectado_en": _sesiones[ruc]["conectado_en"],
                    "error": _sesiones[ruc]["error"],
                    "seleccionada": ruc == _empresa_seleccionada,
                })
        return {"empresa_seleccionada": _empresa_seleccionada, "empresas": empresas}


@app.post("/session/empresas/{ruc}/vincular", summary="Vincula (login) una empresa específica")
async def session_vincular_empresa(ruc: str, background_tasks: BackgroundTasks, usuario: dict = Depends(requiere_rol("admin", "cotizador"))):
    if ruc not in EMPRESAS:
        return JSONResponse(status_code=404, content={"error": "Empresa no configurada"})
    background_tasks.add_task(_vincular_empresa_async, ruc)
    return {"mensaje": f"Vinculación de {ruc} iniciada"}


@app.post("/session/empresas/{ruc}/seleccionar", summary="Marca una empresa como la activa para cotizar")
def session_seleccionar_empresa(ruc: str, usuario: dict = Depends(requiere_rol("admin", "cotizador"))):
    global _empresa_seleccionada
    if ruc not in EMPRESAS:
        return JSONResponse(status_code=404, content={"error": "Empresa no configurada"})
    activa = _session_estado["activa"] if ruc == RUC else _sesiones[ruc]["activa"]
    if not activa:
        return JSONResponse(status_code=409, content={"error": "Esa empresa no tiene una sesión activa. Vincúlala primero."})
    with _lock_sesiones:
        _empresa_seleccionada = ruc
    log(f"🏢 Empresa seleccionada: {ruc}")
    return {"mensaje": "Empresa seleccionada", "empresa_seleccionada": ruc}

@app.delete("/session/empresas/{ruc}/desvincular", summary="Cierra la sesión de una empresa")
def session_desvincular_empresa(ruc: str, usuario: dict = Depends(requiere_rol("admin", "cotizador"))):
    global _token, _refresh_tok
    if ruc not in EMPRESAS:
        return JSONResponse(status_code=404, content={"error": "Empresa no configurada"})
    if ruc == RUC:
        with _lock_token:
            _token = None
            _refresh_tok = None
        _session_estado["activa"] = False
        _session_estado["conectado_en"] = None
        _session_estado["error"] = None
        try:
            TOKEN_FILE.unlink(missing_ok=True)
        except Exception:
            pass
    else:
        with _lock_sesiones:
            _sesiones[ruc] = {"token": None, "refresh": None, "activa": False, "conectado_en": None, "error": None}
        try:
            _token_file_empresa(ruc).unlink(missing_ok=True)
        except Exception:
            pass
    log(f"🔌 Empresa {ruc} desvinculada")
    return {"mensaje": "Empresa desvinculada"}


# ─── ENDPOINT: ACTUALIZAR SOLO ESTADOS (ultra veloz) ─────────────────────────
async def _actualizar_estados_async():
    """
    Solo consulta el buscador (sin detalle ni archivos) y actualiza
    nom_estado_contrato + cotizar en BD. Velocidad: ~500 contratos/segundo.
    """
    global _token, _refresh_tok
    _tarea_activa["corriendo"] = True
    _tarea_activa["modo"] = "estados"
    try:
        _init_pool()
        token, refresh = await login_playwright(RUC, PASSWORD)
        _token = token
        _refresh_tok = refresh
        if token:
            _session_estado["activa"] = True
            _session_estado["conectado_en"] = datetime.now().isoformat()
            _session_estado["error"] = None

        hilo_refresh = threading.Thread(target=_auto_refresh_loop, args=(180,), daemon=True)
        hilo_refresh.start()

        # Traer TODOS los contratos del buscador (solo metadata, sin detalle)
        total_elem, total_pags = obtener_total_paginas(ANIO, 500, solo_vigentes=False)
        log(f"🔄 Actualizando estados de {total_elem} contratos...")

        actualizados = 0
        cambios = 0

        for pg in range(1, total_pags + 1):
            items = obtener_pagina(ANIO, pg, 500, solo_vigentes=False)
            if not items:
                continue

            try:
                conn = _get_conn()
                cur = conn.cursor()
                for it in items:
                    id_c = it["idContrato"]
                    nuevo_estado = it.get("idEstadoContrato")
                    nom_estado   = it.get("nomEstadoContrato", "")
                    cotizar      = 1 if it.get("cotizar") else 0

                    # Solo actualiza si cambió algo
                    cur.execute("""
                        UPDATE contratos
                        SET nom_estado_contrato = %s,
                            id_estado_contrato  = %s,
                            cotizar             = %s,
                            updated_at          = CURRENT_TIMESTAMP
                        WHERE id_contrato = %s
                          AND (nom_estado_contrato != %s OR cotizar != %s)
                    """, (nom_estado, nuevo_estado, cotizar, id_c,
                          nom_estado, cotizar))
                    if cur.rowcount > 0:
                        cambios += 1
                    actualizados += 1

                conn.commit()
                cur.close()
                conn.close()
            except Exception as e:
                log(f"❌ DB error página {pg}: {e}", "ERROR")

            log(f"   ✅ Página {pg}/{total_pags} — {actualizados} revisados, {cambios} cambios")

        log(f"🏁 Estados actualizados: {actualizados} revisados, {cambios} con cambio real")
        enviar_email(actualizados, cambios, 0, "actualizar_estados")

    except Exception as e:
        log(f"❌ Error fatal en actualizar_estados: {e}", "ERROR")
    finally:
        _stop_refresh.set()
        _tarea_activa["corriendo"] = False


@app.post("/actualizar/estados", summary="Actualiza SOLO los estados sin re-extraer todo")
async def actualizar_estados(background_tasks: BackgroundTasks, usuario: dict = Depends(requiere_rol("admin"))):
    if _tarea_activa["corriendo"]:
        return JSONResponse(
            status_code=409,
            content={"error": "Ya hay una tarea corriendo", "modo": _tarea_activa["modo"]}
        )
    background_tasks.add_task(_actualizar_estados_async)
    return {"mensaje": "Actualización de estados iniciada", "modo": "estados"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4000)


