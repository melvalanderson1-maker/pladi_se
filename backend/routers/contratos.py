"""
routers/contratos.py
====================
Router FastAPI que expone los datos de contratos SEACE
desde la base de datos pladibot_db (MySQL).

Endpoints:
  GET  /api/contratos              → lista paginada con filtros
  GET  /api/contratos/stats        → conteos por estado
  GET  /api/contratos/{id}         → detalle completo de un contrato
  GET  /api/contratos/{id}/items   → items del contrato
  GET  /api/contratos/{id}/rtm     → RTM del contrato
  GET  /api/contratos/{id}/etapas  → etapas del contrato
  GET  /api/contratos/{id}/archivos→ archivos (contrato + cotización)
  GET  /api/contratos/{id}/cotizacion → datos completos de cotización
"""

import os
import logging
from typing import Optional, List
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

# ─── STORAGE BACKEND (leer desde .env) ───────────────────────────────────────
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")   # local | azure | aws
AZURE_CONN_STR  = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_CONTAINER = os.getenv("AZURE_CONTAINER_NAME", "seace-archivos")
AWS_BUCKET      = os.getenv("AWS_BUCKET_NAME", "seace-archivos")
AWS_REGION      = os.getenv("AWS_REGION", "us-east-1")

# ─── CARPETA LOCAL DINÁMICA (misma lógica que el scraper) ────────────────────
_DOCS = Path("D:/")
if not _DOCS.exists():
    _DOCS = Path.home()
import os as _os_dir
CARPETA_SALIDA_LOCAL = Path(_os_dir.getenv("SEACE_PLADIBOT_DIR")) if _os_dir.getenv("SEACE_PLADIBOT_DIR") else _DOCS / "SEACE_PLADIBOT"

# ─── UBIGEO → DEPARTAMENTO (código INEI, primeros 2 dígitos) ────────────────
DEPARTAMENTOS_UBIGEO = {
    "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa",
    "05": "Ayacucho", "06": "Cajamarca", "07": "Callao", "08": "Cusco",
    "09": "Huancavelica", "10": "Huánuco", "11": "Ica", "12": "Junín",
    "13": "La Libertad", "14": "Lambayeque", "15": "Lima", "16": "Loreto",
    "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura",
    "21": "Puno", "22": "San Martín", "23": "Tacna", "24": "Tumbes",
    "25": "Ucayali",
}
NOMBRE_A_CODIGO_DEP = {v: k for k, v in DEPARTAMENTOS_UBIGEO.items()}

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
import mysql.connector
from mysql.connector import pooling


import time
from functools import wraps

def ttl_cache(seconds: int):
    """Cachea el resultado de un endpoint por X segundos, por combinación de parámetros."""
    def decorator(func):
        cache = {}
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.time()
            if key in cache:
                data, ts = cache[key]
                if now - ts < seconds:
                    return data
            result = func(*args, **kwargs)
            cache[key] = (result, now)
            return result
        return wrapper
    return decorator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contratos", tags=["contratos"])

# ─── POOL DE CONEXIONES ───────────────────────────────────────────────────────

_pool: Optional[pooling.MySQLConnectionPool] = None

def get_pool() -> pooling.MySQLConnectionPool:
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="pladibot_web",
            pool_size=20,
            host     = os.getenv("MYSQL_HOST",     "localhost"), port=int(os.getenv("MYSQL_PORT", "3306")),
            user     = os.getenv("MYSQL_USER",     "root"),
            password = os.getenv("MYSQL_PASSWORD", "Erick2026#"),
            database = os.getenv("MYSQL_DATABASE", "pladibot_db"),
            charset  = "utf8mb4",
        )
        logger.info("✓ Pool MySQL pladibot_db iniciado")
    return _pool

def get_conn():
    return get_pool().get_connection()


# ─── MODELOS DE RESPUESTA ─────────────────────────────────────────────────────

class ContratoResumen(BaseModel):
    id_contrato          : int
    des_contratacion     : Optional[str]
    nom_objeto_contrato  : Optional[str]
    des_objeto_contrato  : Optional[str]
    nom_entidad          : Optional[str]
    nom_estado_contrato  : Optional[str]
    id_estado_contrato   : Optional[int]
    cotizar              : Optional[bool]
    fec_ini_cotizacion   : Optional[str]
    fec_fin_cotizacion   : Optional[str]
    fec_publica          : Optional[str]
    nom_etapa_contratacion: Optional[str]
    nom_tipo_cotizacion  : Optional[str]
    valor_max_uit        : Optional[float]
    nom_sigla            : Optional[str]
    nom_area_usuaria     : Optional[str]
    num_subsanaciones_total: Optional[int]
    nom_estado_cotiza    : Optional[str]
    total_archivos_contrato  : Optional[int]
    total_archivos_cotizacion: Optional[int]
    cotizacion_usuario   : Optional[str] = None
    cotizacion_empresa   : Optional[str] = None
    cotizacion_estado    : Optional[str] = None
    cotizacion_fecha     : Optional[str] = None
class ContratoDetalle(ContratoResumen):
    nro_contratacion     : Optional[int]
    nom_sigla_cot        : Optional[str]
    nom_area_usuaria_cot : Optional[str]
    dir_organismo        : Optional[str]
    nom_tipo_invitacion  : Optional[str]
    des_ccmn             : Optional[str]
    des_justif_tip_invit : Optional[str]
    num_consultas        : Optional[int]
    num_invitaciones     : Optional[int]
    nom_usu_registro     : Optional[str]
    anio                 : Optional[int]
    updated_at           : Optional[str]

class Archivo(BaseModel):
    id_archivo      : Optional[int]
    nombre          : Optional[str]
    tipo            : Optional[str]
    extension       : Optional[str]
    tamanio         : Optional[str]
    url_descarga    : Optional[str]
    ruta_local      : Optional[str]
    contexto        : Optional[str]
    bytes           : Optional[int]
    rag_document_id : Optional[str] = None

class Item(BaseModel):
    id_contrato_item  : Optional[int]
    cod_cubso         : Optional[str]
    nom_cubso         : Optional[str]
    nom_moneda        : Optional[str]
    nom_unidad_medida : Optional[str]
    descripcion_item  : Optional[str]
    cantidad          : Optional[float]
    precio_total      : Optional[float]
    nom_distrito      : Optional[str]
    nom_estado_cotiza : Optional[str]

class ItemCotizacion(BaseModel):
    id_contrato_item  : Optional[int]
    cod_cubso         : Optional[str]
    nom_cubso         : Optional[str]
    nom_moneda        : Optional[str]
    nom_unidad_medida : Optional[str]
    descripcion_item  : Optional[str]
    cantidad          : Optional[float]
    precio_unitario   : Optional[float]
    precio_total      : Optional[float]

class Rtm(BaseModel):
    id_contrato_rtm   : Optional[int]
    nombre_rtm        : Optional[str]
    valor             : Optional[str]

class RtmCotizacion(BaseModel):
    id_contrato_rtm   : Optional[int]
    nom_rtm           : Optional[str]
    valor_con_rtm     : Optional[str]
    valor_cot_rtm     : Optional[str]

class Etapa(BaseModel):
    id_etapa_contrato  : Optional[int]
    nom_etapa_contrato : Optional[str]
    fec_ini            : Optional[str]
    fec_fin            : Optional[str]

class Oferta(BaseModel):
    id_cotizacion    : Optional[int]
    cod_ruc          : Optional[str]
    nom_razon_social : Optional[str]
    precio_oferta    : Optional[float]
    precio_total     : Optional[float]
    plazo_ejecucion  : Optional[str]
    fec_cotiza       : Optional[str]
    nom_estado_cotiza: Optional[str]
    id_cubso         : Optional[int]
    cod_cubso        : Optional[str]
    cantidad         : Optional[float]
    nom_cubso        : Optional[str]
    descripcion_item : Optional[str]
    nom_unidad_medida: Optional[str]

class CotizacionCompleta(BaseModel):
    items   : List[ItemCotizacion]
    rtm     : List[RtmCotizacion]
    ofertas : List[Oferta]
    archivos: List[Archivo]

class Stats(BaseModel):
    total        : int
    vigentes     : int
    en_evaluacion: int
    culminados   : int
    otros        : int
    con_cotizar  : int

class PaginatedContratos(BaseModel):
    data        : List[ContratoResumen]
    total       : int
    page        : int
    page_size   : int
    total_pages : int


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def row_to_dict(cursor, row):
    """Convierte una fila de MySQL a dict usando los nombres de columna."""
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))

def rows_to_list(cursor, rows):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]





def build_stats_filters(
    alias: str = "c",
    estado: Optional[str] = None,
    resultado: Optional[str] = None,
    anio: Optional[int] = None,
    objeto: Optional[int] = None,
    entidad: Optional[str] = None,
    proveedor: Optional[str] = None,
    departamento: Optional[str] = None,
    provincia: Optional[str] = None,
    distrito: Optional[str] = None,
    producto: Optional[str] = None,
):
    """WHERE + params combinables, reutilizado por TODOS los /stats/*.
    `alias` = alias de la tabla `contratos` en la query que llama esto."""
    wheres, params = [], []

    if estado and estado != "todos":
        mapa = {"vigente": 2, "en_evaluacion": 3, "culminado": 4}
        id_est = mapa.get(estado.lower())
        if id_est:
            wheres.append(f"{alias}.id_estado_contrato = %s")
            params.append(id_est)

    if resultado == "adjudicado":
        wheres.append(f"""{alias}.id_contrato IN (
            SELECT co_r.id_contrato
            FROM cotizacion_ofertas co_r
            WHERE co_r.nom_estado_cotiza = 'ADJUDICADO'
        )""")
    elif resultado == "desierto":
        wheres.append(f"""{alias}.id_contrato IN (
            SELECT co_r.id_contrato
            FROM cotizacion_ofertas co_r
            WHERE co_r.nom_estado_cotiza = 'DESIERTO'
        ) AND {alias}.id_contrato NOT IN (
            SELECT co_r2.id_contrato
            FROM cotizacion_ofertas co_r2
            WHERE co_r2.nom_estado_cotiza = 'ADJUDICADO'
        )""")
    if anio:
        wheres.append(f"{alias}.anio = %s")
        params.append(anio)

    if objeto:
        wheres.append(f"{alias}.id_objeto_contrato = %s")
        params.append(objeto)

    if entidad and entidad.strip():
        wheres.append(f"{alias}.nom_entidad LIKE %s")
        params.append(f"%{entidad.strip()}%")

    if proveedor and proveedor.strip():
        wheres.append(f"""EXISTS (
            SELECT 1 FROM cotizacion_ofertas co_p
            WHERE co_p.id_contrato = {alias}.id_contrato
              AND co_p.nom_razon_social LIKE %s
        )""")
        params.append(f"%{proveedor.strip()}%")

    if producto and producto.strip():
        wheres.append(f"""EXISTS (
            SELECT 1 FROM contrato_items ci_f
            WHERE ci_f.id_contrato = {alias}.id_contrato
              AND ci_f.nom_cubso LIKE %s
        )""")
        params.append(f"%{producto.strip()}%")

    if distrito and distrito.strip():
        wheres.append(f"""{alias}.id_contrato IN (
            SELECT ci_dis.id_contrato FROM contrato_items ci_dis
            WHERE ci_dis.nom_distrito = %s
        )""")
        params.append(distrito.strip())

    if departamento and departamento.strip():
        cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
        if cod_dep:
            wheres.append(f"""{alias}.id_contrato IN (
                SELECT ci_dep.id_contrato FROM contrato_items ci_dep
                WHERE ci_dep.ubigeo LIKE %s
            )""")
            params.append(f"{cod_dep}%")

    if provincia and provincia.strip():
        wheres.append(f"""{alias}.id_contrato IN (
            SELECT ci_prov.id_contrato
            FROM contrato_items ci_prov
            WHERE ci_prov.nom_provincia = %s
        )""")
        params.append(provincia.strip())

    return wheres, params



# ─── ENDPOINTS ───────────────────────────────────────────────────────────────

@router.get("/stats", response_model=Stats)
def get_stats(
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    """Conteos rápidos por estado para los KPI cards del dashboard."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor, departamento=departamento,
            provincia=provincia, distrito=distrito, producto=producto,
        )
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
        cur.execute(f"""
            SELECT
                COUNT(*)                                          AS total,
                SUM(c.id_estado_contrato = 2)                     AS vigentes,
                SUM(c.id_estado_contrato = 3)                     AS en_evaluacion,
                SUM(c.id_estado_contrato = 4)                     AS culminados,
                SUM(c.id_estado_contrato NOT IN (2,3,4))          AS otros,
                SUM(c.cotizar = 1)                                 AS con_cotizar
            FROM contratos c
            {where_sql}
        """, params)
        row = cur.fetchone()
        return Stats(
            total        = int(row[0] or 0),
            vigentes     = int(row[1] or 0),
            en_evaluacion= int(row[2] or 0),
            culminados   = int(row[3] or 0),
            otros        = int(row[4] or 0),
            con_cotizar  = int(row[5] or 0),
        )
    finally:
        cur.close()
        conn.close()





# ══════════════════════════════════════════════════════════════════════════
# NUEVOS ENDPOINTS DE ESTADÍSTICAS AVANZADAS
# ──────────────────────────────────────────────────────────────────────────
# Copia todo este bloque dentro de routers/contratos.py (por ejemplo justo
# después del endpoint GET /stats existente). Usan el mismo `router`,
# `get_conn`, `rows_to_list` y `BaseModel` que ya tienes importados arriba,
# así que no necesitas imports nuevos.
# ══════════════════════════════════════════════════════════════════════════


# ─── MODELOS ─────────────────────────────────────────────────────────────

class EntidadStat(BaseModel):
    nom_entidad   : str
    total         : int
    vigentes      : int
    en_evaluacion : int
    culminados    : int

class GeografiaStat(BaseModel):
    nom_distrito : str
    total        : int

class ProductoStat(BaseModel):
    nom_cubso      : str
    total          : int
    cantidad_total : float

class TimelineStat(BaseModel):
    periodo : str   # "YYYY-MM"
    total   : int

class ObjetoStat(BaseModel):
    nom_objeto_contrato : str
    total                : int


# ─── TOP ENTIDADES QUE MÁS CONTRATAN ──────────────────────────────────────
# Clave para ventas: saber a qué entidades vale la pena postular más seguido.

@router.get("/stats/entidades", response_model=List[EntidadStat])
@ttl_cache(300)
def get_stats_entidades(
    limit       : int            = Query(15, ge=1, le=100),
    q           : Optional[str]  = Query(None, description="Búsqueda libre por nombre de entidad"),
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor, departamento=departamento,
            provincia=provincia, distrito=distrito, producto=producto,
        )
        if q and q.strip():
            wheres.append("c.nom_entidad LIKE %s")
            params.append(f"%{q.strip()}%")
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

        cur.execute(f"""
            SELECT
                COALESCE(c.nom_entidad, 'Sin entidad') AS nom_entidad,
                COUNT(*)                                AS total,
                SUM(c.id_estado_contrato = 2)           AS vigentes,
                SUM(c.id_estado_contrato = 3)           AS en_evaluacion,
                SUM(c.id_estado_contrato = 4)           AS culminados
            FROM contratos c
            {where_sql}
            GROUP BY c.nom_entidad
            ORDER BY total DESC
            LIMIT %s
        """, params + [limit])

        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["total"]         = int(r["total"] or 0)
            r["vigentes"]      = int(r["vigentes"] or 0)
            r["en_evaluacion"] = int(r["en_evaluacion"] or 0)
            r["culminados"]    = int(r["culminados"] or 0)
        return rows
    finally:
        cur.close()
        conn.close()


# ─── CONTRATOS POR DISTRITO (GEOGRAFÍA) ───────────────────────────────────
# nom_distrito vive en contrato_items. Si en tu BD también tienes columnas
# de departamento/provincia (revisa tu tabla), agrégalas al SELECT/GROUP BY
# de la misma forma para tener el desglose completo.

@router.get("/stats/geografia", response_model=List[GeografiaStat])
@ttl_cache(300)
def get_stats_geografia(
    limit       : int            = Query(15, ge=1, le=100),
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres = ["ci.nom_distrito IS NOT NULL", "ci.nom_distrito != ''"]
        params = []

        if departamento and departamento.strip():
            cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
            if cod_dep:
                wheres.append("ci.ubigeo LIKE %s"); params.append(f"{cod_dep}%")

        if provincia and provincia.strip():
            wheres.append("ci.nom_provincia = %s")
            params.append(provincia.strip())

        if distrito and distrito.strip():
            wheres.append("ci.nom_distrito = %s"); params.append(distrito.strip())

        if producto and producto.strip():
            wheres.append("ci.nom_cubso LIKE %s"); params.append(f"%{producto.strip()}%")

        c_wheres, c_params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor,
        )
        wheres += c_wheres
        params += c_params

        where_sql = "WHERE " + " AND ".join(wheres)
        cur.execute(f"""
            SELECT
                COALESCE(ci.nom_distrito, 'Sin distrito') AS nom_distrito,
                COUNT(DISTINCT ci.id_contrato)             AS total
            FROM contrato_items ci
            INNER JOIN contratos c ON c.id_contrato = ci.id_contrato
            {where_sql}
            GROUP BY ci.nom_distrito
            ORDER BY total DESC
            LIMIT %s
        """, params + [limit])
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["total"] = int(r["total"] or 0)
        return rows
    finally:
        cur.close()
        conn.close()

# ─── TOP PRODUCTOS / CATEGORÍAS (CUBSO) MÁS CONTRATADOS ───────────────────
# Agrupa por nom_cubso (categoría de producto/servicio) en todos los items
# de contrato. Si quieres solo los "adjudicados", filtra por
# nom_estado_cotiza = 'Ganador' (ajusta el valor exacto según tu BD).

@router.get("/stats/productos", response_model=List[ProductoStat])
@ttl_cache(300)
def get_stats_productos(
    limit           : int            = Query(15, ge=1, le=100),
    solo_adjudicados: Optional[bool] = Query(False),
    anio            : Optional[int]  = Query(None),
    estado          : Optional[str]  = Query(None),
    resultado       : Optional[str]  = Query(None),
    objeto          : Optional[int]  = Query(None),
    entidad         : Optional[str]  = Query(None),
    proveedor       : Optional[str]  = Query(None),
    departamento    : Optional[str]  = Query(None),
    provincia       : Optional[str]  = Query(None),
    distrito        : Optional[str]  = Query(None),
    producto        : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres = ["ci.nom_cubso IS NOT NULL", "ci.nom_cubso != ''"]
        params = []
        if solo_adjudicados:
            wheres.append("ci.nom_estado_cotiza = 'Ganador'")
        if distrito and distrito.strip():
            wheres.append("ci.nom_distrito = %s"); params.append(distrito.strip())
        if departamento and departamento.strip():
            cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
            if cod_dep:
                wheres.append("LEFT(ci.ubigeo, 2) = %s"); params.append(cod_dep)
        if producto and producto.strip():
            wheres.append("ci.nom_cubso LIKE %s"); params.append(f"%{producto.strip()}%")

        c_wheres, c_params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor,
        )
        wheres += c_wheres
        params += c_params

        where_sql = "WHERE " + " AND ".join(wheres)
        cur.execute(f"""
            SELECT
                COALESCE(ci.nom_cubso, 'Sin categoría') AS nom_cubso,
                COUNT(*)                                 AS total,
                SUM(ci.cantidad)                         AS cantidad_total
            FROM contrato_items ci
            INNER JOIN contratos c ON c.id_contrato = ci.id_contrato
            {where_sql}
            GROUP BY ci.nom_cubso
            ORDER BY total DESC
            LIMIT %s
        """, params + [limit])
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["total"]          = int(r["total"] or 0)
            r["cantidad_total"] = float(r["cantidad_total"] or 0)
        return rows
    finally:
        cur.close()
        conn.close()

# ─── EVOLUCIÓN MENSUAL DE CONTRATOS PUBLICADOS ────────────────────────────

@router.get("/stats/timeline", response_model=List[TimelineStat])
@ttl_cache(300)
def get_stats_timeline(
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor, departamento=departamento,
            provincia=provincia, distrito=distrito, producto=producto,
        )
        wheres = ["c.fec_publica IS NOT NULL", "c.fec_publica != ''"] + wheres
        where_sql = "WHERE " + " AND ".join(wheres)

        # Los formatos de fecha van como parámetros (%s), NO incrustados en el
        # texto del SQL con %% — eso es lo que rompía el endpoint con MySQL.
        formatos_fecha = [
            '%d/%m/%Y %H:%i:%s',
            '%d/%m/%Y',
            '%Y-%m-%d %H:%i:%s',
            '%Y-%m-%d',
            '%Y-%m',  # formato de salida para DATE_FORMAT
        ]

        cur.execute(f"""
            SELECT
                DATE_FORMAT(
                    COALESCE(
                        STR_TO_DATE(c.fec_publica, %s),
                        STR_TO_DATE(c.fec_publica, %s),
                        STR_TO_DATE(c.fec_publica, %s),
                        STR_TO_DATE(c.fec_publica, %s)
                    ), %s
                ) AS periodo,
                COUNT(*) AS total
            FROM contratos c
            {where_sql}
            GROUP BY periodo
            HAVING periodo IS NOT NULL
            ORDER BY periodo
        """, formatos_fecha + params)
        rows = rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()
    for r in rows:
        r["total"] = int(r["total"] or 0)
    return rows
# ─── DISTRIBUCIÓN POR TIPO DE OBJETO (BIEN / SERVICIO / CONSULTORÍA) ──────

@router.get("/stats/objeto", response_model=List[ObjetoStat])
@ttl_cache(300)
def get_stats_objeto(
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, proveedor=proveedor, departamento=departamento,
            provincia=provincia, distrito=distrito, producto=producto,
        )
        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
        cur.execute(f"""
            SELECT
                COALESCE(c.nom_objeto_contrato, 'Sin especificar') AS nom_objeto_contrato,
                COUNT(*)                                            AS total
            FROM contratos c
            {where_sql}
            GROUP BY c.nom_objeto_contrato
            ORDER BY total DESC
        """, params)
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["total"] = int(r["total"] or 0)
        return rows
    finally:
        cur.close()
        conn.close()






class ProveedorStat(BaseModel):
    proveedor    : str
    total        : int
    adjudicados  : int
    desiertos    : int

@router.get("/stats/proveedores", response_model=List[ProveedorStat])
@ttl_cache(300)
def get_stats_proveedores(
    limit       : int            = Query(10, ge=1, le=50),
    anio        : Optional[int]  = Query(None),
    estado      : Optional[str]  = Query(None),
    resultado   : Optional[str]  = Query(None),
    objeto      : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    """Ranking de proveedores: contratos ganados (adjudicados) vs perdidos (desiertos),
    respetando TODOS los filtros activos (departamento, provincia, año, entidad, etc)."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, estado=estado, resultado=resultado, objeto=objeto,
            entidad=entidad, departamento=departamento,
            provincia=provincia, distrito=distrito, producto=producto,
        )
        wheres = ["co.nom_razon_social IS NOT NULL", "co.nom_razon_social != ''"] + wheres
        where_sql = "WHERE " + " AND ".join(wheres)

        cur.execute(f"""
            SELECT
                co.nom_razon_social AS proveedor,
                COUNT(DISTINCT co.id_contrato) AS total,
                COUNT(DISTINCT CASE WHEN co.nom_estado_cotiza = 'ADJUDICADO' THEN co.id_contrato END) AS adjudicados,
                COUNT(DISTINCT CASE WHEN co.nom_estado_cotiza = 'DESIERTO'   THEN co.id_contrato END) AS desiertos
            FROM cotizacion_ofertas co
            INNER JOIN contratos c ON c.id_contrato = co.id_contrato
            {where_sql}
            GROUP BY co.nom_razon_social
            ORDER BY adjudicados DESC, total DESC
            LIMIT %s
        """, params + [limit])
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["total"] = int(r["total"] or 0)
            r["adjudicados"] = int(r["adjudicados"] or 0)
            r["desiertos"] = int(r["desiertos"] or 0)
        return rows
    finally:
        cur.close()
        conn.close()


# ─── CONTEO ADJUDICADOS/DESIERTOS DENTRO DE CULMINADOS (para los tabs) ────

class ResultadoCulminadosStat(BaseModel):
    total       : int
    adjudicados : int
    desiertos   : int

@router.get("/stats/resultado-culminados", response_model=ResultadoCulminadosStat)
def get_stats_resultado_culminados(
    anio        : Optional[int]  = Query(None),
    entidad     : Optional[str]  = Query(None),
    proveedor   : Optional[str]  = Query(None),
    departamento: Optional[str]  = Query(None),
    provincia   : Optional[str]  = Query(None),
    distrito    : Optional[str]  = Query(None),
    producto    : Optional[str]  = Query(None),
):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres, params = build_stats_filters(
            alias="c", anio=anio, entidad=entidad, proveedor=proveedor,
            departamento=departamento, provincia=provincia, distrito=distrito,
            producto=producto,
        )
        wheres = ["c.id_estado_contrato = 4"] + wheres
        where_sql = "WHERE " + " AND ".join(wheres)
        cur.execute(f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN ro.tiene_adjudicado = 1 THEN 1 ELSE 0 END) AS adjudicados,
                SUM(CASE WHEN (ro.tiene_adjudicado IS NULL OR ro.tiene_adjudicado = 0)
                          AND ro.tiene_desierto = 1 THEN 1 ELSE 0 END) AS desiertos
            FROM contratos c
            LEFT JOIN (
                SELECT id_contrato,
                       MAX(nom_estado_cotiza = 'ADJUDICADO') AS tiene_adjudicado,
                       MAX(nom_estado_cotiza = 'DESIERTO')   AS tiene_desierto
                FROM cotizacion_ofertas
                GROUP BY id_contrato
            ) ro ON ro.id_contrato = c.id_contrato
            {where_sql}
        """, params)
        row = cur.fetchone()
        return ResultadoCulminadosStat(
            total=int(row[0] or 0), adjudicados=int(row[1] or 0), desiertos=int(row[2] or 0),
        )
    finally:
        cur.close()
        conn.close()


class OpcionesFiltro(BaseModel):
    entidades    : List[str]
    proveedores  : List[str]
    productos    : List[str]
    distritos    : List[str]
    provincias   : List[str]
    departamentos: List[str]

@router.get("/filtros/opciones", response_model=OpcionesFiltro)
@ttl_cache(600)
def get_opciones_filtro():
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT nom_entidad FROM contratos WHERE nom_entidad IS NOT NULL AND nom_entidad != '' ORDER BY nom_entidad LIMIT 500")
        entidades = [r[0] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT nom_razon_social FROM cotizacion_ofertas WHERE nom_razon_social IS NOT NULL AND nom_razon_social != '' ORDER BY nom_razon_social LIMIT 500")
        proveedores = [r[0] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT nom_cubso FROM contrato_items WHERE nom_cubso IS NOT NULL AND nom_cubso != '' ORDER BY nom_cubso LIMIT 500")
        productos = [r[0] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT nom_distrito FROM contrato_items WHERE nom_distrito IS NOT NULL AND nom_distrito != '' ORDER BY nom_distrito LIMIT 500")
        distritos = [r[0] for r in cur.fetchall()]

        cur.execute("""
            SELECT DISTINCT LEFT(ubigeo, 2) FROM contrato_items
            WHERE ubigeo IS NOT NULL AND LENGTH(ubigeo) >= 2
        """)
        codigos_dep = [r[0] for r in cur.fetchall() if r[0]]
        departamentos = sorted({
            DEPARTAMENTOS_UBIGEO.get(cod, f"Departamento {cod}") for cod in codigos_dep
        })

        return OpcionesFiltro(
            entidades=entidades, proveedores=proveedores, productos=productos,
            distritos=distritos, provincias=[], departamentos=departamentos,
        )
    finally:
        cur.close()
        conn.close()



@router.get("/filtros/entidades", response_model=List[str])
def buscar_entidades(q: str = Query(..., min_length=2), limit: int = Query(15, ge=1, le=50)):
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DISTINCT nom_entidad FROM contratos
            WHERE nom_entidad LIKE %s
            ORDER BY nom_entidad
            LIMIT %s
        """, (f"%{q.strip()}%", limit))
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/filtros/proveedores", response_model=List[str])
def buscar_proveedores(q: str = Query(..., min_length=2), limit: int = Query(15, ge=1, le=50)):
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DISTINCT nom_razon_social FROM cotizacion_ofertas
            WHERE nom_razon_social LIKE %s
            ORDER BY nom_razon_social
            LIMIT %s
        """, (f"%{q.strip()}%", limit))
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()

@router.get("/filtros/productos", response_model=List[str])
def buscar_productos(q: str = Query(..., min_length=2), limit: int = Query(15, ge=1, le=50)):
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DISTINCT nom_cubso FROM contrato_items
            WHERE nom_cubso LIKE %s
            ORDER BY nom_cubso
            LIMIT %s
        """, (f"%{q.strip()}%", limit))
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()



@router.get("/filtros/provincias", response_model=List[str])
@ttl_cache(600)
def get_provincias_por_departamento(departamento: str = Query(...)):
    cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
    if not cod_dep:
        return []
    conn = get_conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DISTINCT ur.provincia
            FROM contrato_items ci
            INNER JOIN ubigeo_referencia ur ON ur.cod_ubigeo = ci.ubigeo
            WHERE LEFT(ur.cod_ubigeo, 2) = %s
            ORDER BY ur.provincia
        """, (cod_dep,))
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


@router.get("/filtros/distritos", response_model=List[str])
@ttl_cache(600)
def get_distritos_por_provincia(
    departamento: str = Query(...),
    provincia: Optional[str] = Query(None),
):
    cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
    if not cod_dep:
        return []
    conn = get_conn(); cur = conn.cursor()
    try:
        wheres = ["LEFT(ur.cod_ubigeo, 2) = %s"]
        params = [cod_dep]
        if provincia:
            wheres.append("ur.provincia = %s")
            params.append(provincia)
        cur.execute(f"""
            SELECT DISTINCT ur.distrito
            FROM contrato_items ci
            INNER JOIN ubigeo_referencia ur ON ur.cod_ubigeo = ci.ubigeo
            WHERE {" AND ".join(wheres)}
            ORDER BY ur.distrito
        """, params)
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


@router.get("/by-rag-id/{rag_document_id}/file")
def get_file_by_rag_id(rag_document_id: str, request: Request):
    """
    Sirve el archivo físico buscándolo por su rag_document_id.
    Usado por PDFViewer cuando el source viene de un archivo SEACE indexado.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension, id_contrato, id_archivo
            FROM archivos
            WHERE rag_document_id = %s
            LIMIT 1
        """, (rag_document_id,))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado para ese rag_document_id")

    ruta_local, nombre, extension, id_contrato, id_archivo = row

    # Reutilizar la misma lógica de reparación de ruta
    ruta = _reparar_ruta(ruta_local)
    if not ruta:
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    ext = (extension or '').lower().strip('.')

    # Si es DOCX → convertir a PDF en vuelo para el visor
    if ext in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        try:
            pdf_path = Path(tmp_dir) / "output.pdf"
            ruta_ps  = str(ruta).replace("'", "\\'")
            pdf_ps   = str(pdf_path).replace("'", "\\'")
            ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=60
            )
            if not pdf_path.exists():
                raise HTTPException(status_code=500, detail=f"Error convirtiendo DOCX: {result.stderr}")
            pdf_bytes = pdf_path.read_bytes()
            return StreamingResponse(
                iter([pdf_bytes]),
                media_type="application/pdf",
                headers={"Content-Disposition": "inline", "Access-Control-Allow-Origin": "*"}
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    mime, _ = mimetypes.guess_type(str(ruta))
    mime = mime or "application/octet-stream"
    return FileResponse(
        path=str(ruta),
        media_type=mime,
        headers={"Content-Disposition": "inline", "Access-Control-Allow-Origin": "*"}
    )


@router.get("", response_model=PaginatedContratos)
def list_contratos(
    page        : int            = Query(1,    ge=1),
    page_size   : int            = Query(20,   ge=1, le=200),
    estado      : Optional[str]  = Query(None, description="vigente|en_evaluacion|culminado|todos"),
    q           : Optional[str]  = Query(None, description="Busca en código, entidad, descripción"),
    cotizar     : Optional[bool] = Query(None, description="Filtra solo los que se pueden cotizar"),
    anio        : Optional[int]  = Query(None),
    objeto      : Optional[int]  = Query(None, description="1=Bien, 2=Servicio, 3=Obra, 4=Consultoría de Obra"),
    solo_mios   : Optional[bool] = Query(None, description="Filtra contratos donde GRUPO ECOLIMP tiene oferta"),
    proveedor   : Optional[str]  = Query(None, description="Filtra por nombre de proveedor/empresa que ofertó"),
    entidad     : Optional[str]  = Query(None, description="Filtra por nombre de entidad contratante"),
    descripcion : Optional[str]  = Query(None, description="Filtra por descripción del contrato/producto"),
    resultado   : Optional[str]  = Query(None, description="adjudicado|desierto — sub-filtro de culminados"),
    departamento: Optional[str]  = Query(None, description="Filtra por departamento (vía ubigeo de contrato_items)"),
    provincia   : Optional[str]  = Query(None, description="Filtra por provincia"),
    distrito    : Optional[str]  = Query(None, description="Filtra por distrito"),
):
    """
    Lista paginada de contratos con filtros.
    El frontend usa este endpoint para la grid principal.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres = []
        params = []

        # Filtro por estado
        if estado and estado != "todos":
            mapa = {
                "vigente"      : 2,
                "en_evaluacion": 3,
                "culminado"    : 4,
            }
            id_est = mapa.get(estado.lower())
            if id_est:
                wheres.append("c.id_estado_contrato = %s")
                params.append(id_est)

        # Filtro cotizarfv
        if cotizar is not None:
            wheres.append("c.cotizar = %s")
            params.append(1 if cotizar else 0)

        # Filtro año
        # Filtro año
        if anio:
            wheres.append("c.anio = %s")
            params.append(anio)

        # Filtro objeto (Bien / Servicio / Consultoría)
        if objeto:
            wheres.append("c.id_objeto_contrato = %s")
            params.append(objeto)

        # Filtro "Mis ofertas" — contratos donde GRUPO ECOLIMP participó
        if solo_mios:
            wheres.append("""EXISTS (
                SELECT 1 FROM cotizacion_ofertas co
                WHERE co.id_contrato = c.id_contrato
                AND co.nom_razon_social LIKE %s
            )""")
            params.append("%GRUPO ECOLIMP%")

        # Filtro "Buscar por proveedor" — separado del buscador de texto principal
        # a propósito, para no volver a mezclar EXISTS con el OR de MATCH/LIKE
        # (eso fue lo que causaba los 10 segundos de antes).
        if proveedor and proveedor.strip():
            wheres.append("""EXISTS (
                SELECT 1 FROM cotizacion_ofertas co
                WHERE co.id_contrato = c.id_contrato
                AND co.nom_razon_social LIKE %s
            )""")
            params.append(f"%{proveedor.strip()}%")

        # Filtro específico por entidad (columna única, más rápido que el buscador general)
        if entidad and entidad.strip():
            wheres.append("c.nom_entidad LIKE %s")
            params.append(f"%{entidad.strip()}%")

        # Filtro específico por descripción del contrato/producto
        if descripcion and descripcion.strip():
            like_desc = f"%{descripcion.strip()}%"
            wheres.append("(c.des_objeto_contrato LIKE %s OR c.nom_objeto_contrato LIKE %s)")
            params += [like_desc, like_desc]

        # Filtro geográfico (departamento/provincia/distrito) — vía contrato_items.ubigeo,
        # mismo patrón que build_stats_filters() y get_stats_geografia().
        if distrito and distrito.strip():
            wheres.append("""EXISTS (
                SELECT 1 FROM contrato_items ci_dis
                WHERE ci_dis.id_contrato = c.id_contrato
                  AND ci_dis.nom_distrito = %s
            )""")
            params.append(distrito.strip())

        if provincia and provincia.strip():
            wheres.append("""EXISTS (
                SELECT 1 FROM contrato_items ci_prov
                WHERE ci_prov.id_contrato = c.id_contrato
                  AND ci_prov.nom_provincia = %s
            )""")
            params.append(provincia.strip())

        if departamento and departamento.strip():
            cod_dep = NOMBRE_A_CODIGO_DEP.get(departamento.strip())
            if cod_dep:
                wheres.append("""EXISTS (
                    SELECT 1 FROM contrato_items ci_dep
                    WHERE ci_dep.id_contrato = c.id_contrato
                      AND ci_dep.ubigeo LIKE %s
                )""")
                params.append(f"{cod_dep}%")

        # Filtro por resultado de cotización — EXISTS correlacionado por
        # contrato, en vez de agrupar TODA cotizacion_ofertas en un derived
        # table. Con el índice (id_contrato, nom_estado_cotiza) esto resuelve
        # con index lookup puntual por fila, no con escaneo completo.
        join_resultado_sql = ""
        if resultado == "adjudicado":
            wheres.append("""EXISTS (
                SELECT 1 FROM cotizacion_ofertas co_r
                WHERE co_r.id_contrato = c.id_contrato
                  AND co_r.nom_estado_cotiza = 'ADJUDICADO'
            )""")
        elif resultado == "desierto":
            wheres.append("""NOT EXISTS (
                SELECT 1 FROM cotizacion_ofertas co_r
                WHERE co_r.id_contrato = c.id_contrato
                  AND co_r.nom_estado_cotiza = 'ADJUDICADO'
            ) AND EXISTS (
                SELECT 1 FROM cotizacion_ofertas co_r2
                WHERE co_r2.id_contrato = c.id_contrato
                  AND co_r2.nom_estado_cotiza = 'DESIERTO'
            )""")

        # Búsqueda texto: DOS rutas, cada una usando SOLO índices (nada de EXISTS
        # mezclado con OR — eso rompía el uso del índice y causaba 10+ segundos).
        # - Con guion (ej "CM-185-2026-UNAAT") = código → LIKE de prefijo.
        # - Sin guion (ej "papel") = texto libre → FULLTEXT.
        if q and q.strip():
            import re
            termino = q.strip()
            es_codigo = '-' in termino

            if es_codigo:
                like_prefijo = f"{termino}%"
                wheres.append("""(
                    c.des_contratacion LIKE %s OR
                    c.nom_sigla        LIKE %s
                )""")
                params += [like_prefijo, like_prefijo]
            else:
                tokens = [t for t in re.split(r'[^0-9A-Za-zÀ-ÿ]+', termino) if len(t) >= 3]
                busqueda_bool = " ".join(f"+{t}*" for t in tokens) or f"+{termino}*"
                wheres.append("""
                    MATCH(c.des_contratacion, c.nom_entidad, c.des_objeto_contrato, c.nom_sigla)
                    AGAINST (%s IN BOOLEAN MODE)
                """)
                params += [busqueda_bool]

        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

        # Total
        cur.execute(f"SELECT COUNT(*) FROM contratos c {join_resultado_sql} {where_sql}", params)
        total = cur.fetchone()[0]

        # Datos — paginación en 2 fases:
        # 1) Resuelve SOLO los IDs de la página con el filtro liviano
        #    (usa idx_contratos_estado_id + EXISTS indexado, sin cargar
        #    LATERAL ni subqueries de archivos todavía).
        # 2) Trae los datos completos (LATERAL + archivos) SOLO para esos
        #    24 IDs ya decididos, evitando hidratar las filas descartadas.
        offset = (page - 1) * page_size
        cur.execute(f"""
            SELECT c.id_contrato
            FROM contratos c
            {join_resultado_sql}
            {where_sql}
            ORDER BY c.id_contrato DESC
            LIMIT %s OFFSET %s
        """, params + [page_size, offset])
        ids_pagina = [r[0] for r in cur.fetchall()]

        if not ids_pagina:
            rows = []
        else:
            placeholders = ",".join(["%s"] * len(ids_pagina))
            cur.execute(f"""
                SELECT
                    c.id_contrato,
                    c.des_contratacion,
                    c.nom_objeto_contrato,
                    c.des_objeto_contrato,
                    c.nom_entidad,
                    c.nom_estado_contrato,
                    c.id_estado_contrato,
                    c.cotizar,
                    c.fec_ini_cotizacion,
                    c.fec_fin_cotizacion,
                    c.fec_publica,
                    c.nom_etapa_contratacion,
                    c.nom_tipo_cotizacion,
                    c.valor_max_uit,
                    c.nom_sigla,
                    c.nom_area_usuaria,
                    c.num_subsanaciones_total,
                    c.nom_estado_cotiza,
                    (SELECT COUNT(*) FROM archivos a
                     WHERE a.id_contrato = c.id_contrato AND a.contexto = 'contrato')   AS total_archivos_contrato,
                    (SELECT COUNT(*) FROM archivos a
                     WHERE a.id_contrato = c.id_contrato AND a.contexto = 'cotizacion') AS total_archivos_cotizacion,
                    mc.usuario            AS cotizacion_usuario,
                    mc.empresa            AS cotizacion_empresa,
                    mc.estado_cotizacion  AS cotizacion_estado,
                    mc.fecha_cotizado     AS cotizacion_fecha
                FROM contratos c
                LEFT JOIN LATERAL (
                    SELECT mc1.estado_cotizacion, mc1.fecha_cotizado,
                           u.nombre AS usuario, e.razon_social AS empresa
                    FROM mis_cotizaciones mc1
                    LEFT JOIN usuarios u ON u.id = mc1.id_usuario
                    LEFT JOIN empresas e ON e.id = mc1.id_empresa
                    WHERE mc1.id_contrato = c.id_contrato
                    ORDER BY mc1.fecha_cotizado DESC
                    LIMIT 1
                ) mc ON TRUE
                WHERE c.id_contrato IN ({placeholders})
                ORDER BY c.id_contrato DESC
            """, ids_pagina)
            rows = rows_to_list(cur, cur.fetchall())

        # Normalizar tipos
        for r in rows:
            r["cotizar"] = bool(r.get("cotizar"))
            r["valor_max_uit"] = float(r["valor_max_uit"]) if r.get("valor_max_uit") else None
            if r.get("cotizacion_fecha"):
                r["cotizacion_fecha"] = str(r["cotizacion_fecha"])

        import math
        return PaginatedContratos(
            data       = rows,
            total      = total,
            page       = page,
            page_size  = page_size,
            total_pages= math.ceil(total / page_size),
        )
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}", response_model=ContratoDetalle)
def get_contrato(id_contrato: int):
    """Detalle completo de un contrato por ID."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT
                c.*,
                COALESCE(ac.n_contrato, 0)   AS total_archivos_contrato,
                COALESCE(aq.n_cotizacion, 0) AS total_archivos_cotizacion
            FROM contratos c
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_contrato
                FROM archivos WHERE contexto = 'contrato'
                GROUP BY id_contrato
            ) ac ON ac.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_cotizacion
                FROM archivos WHERE contexto = 'cotizacion'
                GROUP BY id_contrato
            ) aq ON aq.id_contrato = c.id_contrato
            WHERE c.id_contrato = %s
        """, (id_contrato,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Contrato {id_contrato} no encontrado")
        data = row_to_dict(cur, row)
        data["cotizar"] = bool(data.get("cotizar"))
        # Excluir campos muy pesados que no se usan en el detalle UI
        data.pop("raw_detalle", None)
        data.pop("raw_completo_cotizacion", None)
        if data.get("valor_max_uit"):
            data["valor_max_uit"] = float(data["valor_max_uit"])
        if data.get("updated_at"):
            data["updated_at"] = str(data["updated_at"])
        return data
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/archivos", response_model=List[Archivo])
def get_archivos(
    id_contrato: int,
    contexto: Optional[str] = Query(None, description="contrato|cotizacion|todos"),
):
    """
    Archivos del contrato.
    contexto=contrato    → solo los del contrato base
    contexto=cotizacion  → solo los de cotización
    contexto=todos o None→ todos
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        if contexto and contexto != "todos":
            cur.execute("""
                SELECT id_archivo, nombre, tipo, extension,
                       tamanio, url_descarga, ruta_local, contexto, bytes,
                       rag_document_id
                FROM archivos
                WHERE id_contrato = %s AND contexto = %s
                ORDER BY contexto, id
            """, (id_contrato, contexto))
        else:
            cur.execute("""
                SELECT id_archivo, nombre, tipo, extension,
                       tamanio, url_descarga, ruta_local, contexto, bytes,
                       rag_document_id
                FROM archivos
                WHERE id_contrato = %s
                ORDER BY contexto, id
            """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/items", response_model=List[Item])
def get_items(id_contrato: int):
    """Items (productos/servicios) del contrato base."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_contrato_item, cod_cubso, nom_cubso,
                   nom_moneda, nom_unidad_medida, descripcion_item,
                   cantidad, precio_total, nom_distrito, nom_estado_cotiza
            FROM contrato_items
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["cantidad"]    = float(r["cantidad"])    if r.get("cantidad")    else None
            r["precio_total"]= float(r["precio_total"])if r.get("precio_total")else None
        return rows
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/rtm", response_model=List[Rtm])
def get_rtm(id_contrato: int):
    """Requisitos Técnicos Mínimos del contrato."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_contrato_rtm, nombre_rtm, valor
            FROM contrato_rtm
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/etapas", response_model=List[Etapa])
def get_etapas(id_contrato: int):
    """Etapas del proceso de contratación."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_etapa_contrato, nom_etapa_contrato, fec_ini, fec_fin
            FROM contrato_etapas
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


# ─── ARCHIVOS SUBIDOS POR EL USUARIO AL COTIZAR (auditoría) ──────────────────

class ArchivoCotizacionSubido(BaseModel):
    id                  : int
    id_contrato_archivo : int
    id_usuario          : int
    nombre_usuario      : Optional[str]
    id_empresa          : int
    razon_social        : Optional[str]
    nombre_archivo      : str
    extension           : Optional[str]
    bytes               : Optional[int]
    fecha_subida        : Optional[str]


@router.get("/{id_contrato}/cotizacion/{id_cotizacion}/archivos-subidos", response_model=List[ArchivoCotizacionSubido])
def listar_archivos_subidos(id_contrato: int, id_cotizacion: int):
    """Auditoría: qué archivos se subieron, quién los subió y con qué empresa,
    para una cotización específica de un contrato específico."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT
                acs.id, acs.id_contrato_archivo,
                acs.id_usuario, u.nombre AS nombre_usuario,
                acs.id_empresa, e.razon_social,
                acs.nombre_archivo, acs.extension, acs.bytes, acs.fecha_subida
            FROM archivos_cotizacion_subidos acs
            LEFT JOIN usuarios u ON u.id = acs.id_usuario
            LEFT JOIN empresas e ON e.id = acs.id_empresa
            WHERE acs.id_contrato = %s AND acs.id_cotizacion = %s
            ORDER BY acs.fecha_subida DESC
        """, (id_contrato, id_cotizacion))
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            if r.get("fecha_subida"):
                r["fecha_subida"] = str(r["fecha_subida"])
        return rows
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/cotizacion/{id_cotizacion}/archivos-subidos/{id_registro}/descargar")
def descargar_archivo_subido(id_contrato: int, id_cotizacion: int, id_registro: int, request: Request):
    """
    Sirve el archivo subido por el usuario, resolviendo según el
    storage_backend GUARDADO EN ESE REGISTRO (no el actual del .env) —
    así, si migras de storage en el futuro, los archivos viejos siguen
    sirviéndose correctamente y los nuevos usan el backend nuevo.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT nombre_archivo, storage_backend, ruta_o_key
            FROM archivos_cotizacion_subidos
            WHERE id = %s AND id_contrato = %s AND id_cotizacion = %s
            LIMIT 1
        """, (id_registro, id_contrato, id_cotizacion))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    nombre_archivo, backend_guardado, ruta_o_key = row

    # ── AZURE ─────────────────────────────────────────────────────────────
    if backend_guardado == "azure":
        try:
            from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
            from datetime import timedelta, timezone, datetime as dt
            blob_name = ruta_o_key.split("/")[-1] if ruta_o_key.startswith("http") else ruta_o_key
            client      = BlobServiceClient.from_connection_string(AZURE_CONN_STR)
            blob_client = client.get_blob_client(container=AZURE_CONTAINER, blob=blob_name)
            sas = generate_blob_sas(
                account_name   = client.account_name,
                container_name = AZURE_CONTAINER,
                blob_name      = blob_name,
                account_key    = client.credential.account_key,
                permission     = BlobSasPermissions(read=True),
                expiry         = dt.now(timezone.utc) + timedelta(minutes=15),
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{blob_client.url}?{sas}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error Azure: {e}")

    # ── AWS S3 ────────────────────────────────────────────────────────────
    if backend_guardado == "aws":
        try:
            import boto3
            s3_key = ruta_o_key.split("/")[-1] if ruta_o_key.startswith("http") else ruta_o_key
            s3  = boto3.client("s3", region_name=AWS_REGION)
            url = s3.generate_presigned_url(
                "get_object",
                Params    = {"Bucket": AWS_BUCKET, "Key": s3_key},
                ExpiresIn = 900,
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error AWS S3: {e}")

    # ── LOCAL (default) — misma lógica de reparación de ruta dinámica ──────
    ruta = CARPETA_SALIDA_LOCAL / ruta_o_key
    if not ruta.exists():
        raise HTTPException(status_code=404, detail=f"Archivo no encontrado en disco: {ruta_o_key}")

    mime, _ = mimetypes.guess_type(str(ruta))
    mime = mime or "application/octet-stream"
    return FileResponse(
        path       = str(ruta),
        media_type = mime,
        filename   = nombre_archivo,
        headers    = {
            "Content-Disposition": f'attachment; filename="{nombre_archivo}"',
            "Access-Control-Allow-Origin": "*",
        }
    )


@router.get("/{id_contrato}/cotizacion", response_model=CotizacionCompleta)
def get_cotizacion(id_contrato: int):
    """
    Todo lo relacionado a la cotización de un contrato:
    items, RTM, ofertas recibidas y archivos de cotización.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        # Items cotización
        cur.execute("""
            SELECT id_contrato_item, cod_cubso, nom_cubso,
                   nom_moneda, nom_unidad_medida, descripcion_item,
                   cantidad, precio_unitario, precio_total
            FROM cotizacion_items
            WHERE id_contrato = %s ORDER BY id
        """, (id_contrato,))
        items = rows_to_list(cur, cur.fetchall())
        for r in items:
            r["cantidad"]       = float(r["cantidad"])       if r.get("cantidad")       else None
            r["precio_unitario"]= float(r["precio_unitario"])if r.get("precio_unitario")else None
            r["precio_total"]   = float(r["precio_total"])   if r.get("precio_total")   else None

        # RTM cotización
        cur.execute("""
            SELECT id_contrato_rtm, nom_rtm, valor_con_rtm, valor_cot_rtm
            FROM cotizacion_rtm
            WHERE id_contrato = %s ORDER BY id
        """, (id_contrato,))
        rtm = rows_to_list(cur, cur.fetchall())

        # Ofertas
        # Ofertas — JOIN con contrato_items para traer cantidad/cubso/descripcion
        # cuando la oferta es DESIERTO y esos datos están en contrato_items
        cur.execute("""
            SELECT
                co.id_cotizacion, co.cod_ruc, co.nom_razon_social,
                co.precio_oferta, co.precio_total, co.plazo_ejecucion,
                co.fec_cotiza, co.nom_estado_cotiza,
                co.id_cubso, co.cod_cubso,
                COALESCE(co.cantidad,    ci.cantidad)         AS cantidad,
                COALESCE(co.nom_cubso,   ci.nom_cubso)        AS nom_cubso,
                COALESCE(co.descripcion_item, ci.descripcion_item) AS descripcion_item,
                COALESCE(co.nom_unidad_medida, ci.nom_unidad_medida) AS nom_unidad_medida
            FROM cotizacion_ofertas co
            LEFT JOIN contrato_items ci
                ON ci.id_contrato = co.id_contrato
               AND ci.cod_cubso   = co.cod_cubso
            WHERE co.id_contrato = %s
            ORDER BY co.precio_total ASC
        """, (id_contrato,))
        ofertas = rows_to_list(cur, cur.fetchall())
        for r in ofertas:
            r["precio_oferta"] = float(r["precio_oferta"]) if r.get("precio_oferta") else None
            r["precio_total"]  = float(r["precio_total"])  if r.get("precio_total")  else None
            r["cantidad"]      = float(r["cantidad"])       if r.get("cantidad")      else None

        # Archivos cotización
        cur.execute("""
            SELECT id_archivo, nombre, tipo, extension,
                   tamanio, url_descarga, ruta_local, contexto, bytes
            FROM archivos
            WHERE id_contrato = %s AND contexto = 'cotizacion'
            ORDER BY id
        """, (id_contrato,))
        archivos = rows_to_list(cur, cur.fetchall())

        return CotizacionCompleta(
            items   = items,
            rtm     = rtm,
            ofertas = ofertas,
            archivos= archivos,
        )
    finally:
        cur.close()
        conn.close()


import mimetypes
from fastapi.responses import FileResponse


@router.get("/{id_contrato}/archivos/{id_archivo}/descargar")
def descargar_archivo_local(id_contrato: int, id_archivo: int, request: Request, id_cotizacion: Optional[int] = None):
    logger.info(f"[DESCARGA] Petición desde {request.client.host} — contrato={id_contrato} archivo={id_archivo} id_cotizacion={id_cotizacion}")
    """
    Sirve el archivo según STORAGE_BACKEND:
      - local → FileResponse desde disco (ruta dinámica)
      - azure → redirect a SAS URL temporal
      - aws   → redirect a presigned URL
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension
            FROM archivos
            WHERE id_contrato = %s AND id_archivo = %s
            LIMIT 1
        """, (id_contrato, id_archivo))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local, nombre, extension = row

    if not ruta_local:
        raise HTTPException(status_code=404, detail="Este archivo no tiene ruta local guardada")

    # Si existe una versión rellenada por IA para esta cotización, servir esa
    # en vez del original (el auto-relleno de Gemini la escribe en esta ruta).
    if id_cotizacion:
        ruta_relleno = CARPETA_SALIDA_LOCAL / "cotizaciones" / str(id_contrato) / str(id_cotizacion) / "rellenos" / f"relleno_{id_archivo}.docx"
        if ruta_relleno.exists():
            logger.info(f"[DESCARGA] Sirviendo versión rellenada por IA: {ruta_relleno}")
            return FileResponse(
                path       = str(ruta_relleno),
                media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                filename   = nombre or ruta_relleno.name,
                headers    = {
                    "Content-Disposition": f'attachment; filename="{nombre or ruta_relleno.name}"',
                    "Access-Control-Allow-Origin": "*",
                }
            )

    # ── AZURE ─────────────────────────────────────────────────────────────────
    if STORAGE_BACKEND == "azure":
        try:
            from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
            from datetime import timedelta, timezone, datetime as dt
            blob_name = Path(ruta_local).name   # la url guardada trae el nombre al final
            # si ruta_local es una URL completa, extraer solo el blob name
            if ruta_local.startswith("http"):
                blob_name = ruta_local.split("/")[-1]
            client      = BlobServiceClient.from_connection_string(AZURE_CONN_STR)
            blob_client = client.get_blob_client(container=AZURE_CONTAINER, blob=blob_name)
            sas = generate_blob_sas(
                account_name   = client.account_name,
                container_name = AZURE_CONTAINER,
                blob_name      = blob_name,
                account_key    = client.credential.account_key,
                permission     = BlobSasPermissions(read=True),
                expiry         = dt.now(timezone.utc) + timedelta(minutes=15),
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{blob_client.url}?{sas}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error Azure: {e}")

    # ── AWS S3 ────────────────────────────────────────────────────────────────
    if STORAGE_BACKEND == "aws":
        try:
            import boto3
            s3_key = Path(ruta_local).name
            if ruta_local.startswith("http"):
                s3_key = ruta_local.split("/")[-1]
            s3  = boto3.client("s3", region_name=AWS_REGION)
            url = s3.generate_presigned_url(
                "get_object",
                Params     = {"Bucket": AWS_BUCKET, "Key": s3_key},
                ExpiresIn  = 900,   # 15 min
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error AWS S3: {e}")

    # ── LOCAL (default) ───────────────────────────────────────────────────────
    # Reconstruir ruta dinámica: si la ruta guardada en BD pertenece
    # a otro usuario (distinto PC), reemplazar la parte fija por la actual.
    ruta = Path(ruta_local)
    if not ruta.exists():
        # Ruta relativa nueva (archivos\73469\...)
        ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta2.exists():
            ruta = ruta2
        else:
            # Ruta absoluta vieja con otro usuario
            partes = ruta.parts
            try:
                idx      = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa = Path(*partes[idx+1:])
                ruta3    = CARPETA_SALIDA_LOCAL / relativa
                if ruta3.exists():
                    ruta = ruta3
            except StopIteration:
                pass

    if not ruta.exists():
        raise HTTPException(status_code=404, detail=f"Archivo no encontrado en disco: {ruta_local}")

    mime, _ = mimetypes.guess_type(str(ruta))
    mime     = mime or "application/octet-stream"
    nombre_limpio = nombre or ruta.name

    return FileResponse(
        path       = str(ruta),
        media_type = mime,
        filename   = nombre_limpio,
        headers    = {
            "Content-Disposition": f'attachment; filename="{nombre_limpio}"',
            "Access-Control-Allow-Origin": "*",
        }
    )






@router.get("/{id_contrato}/archivos/{id_archivo}/descargar-docx")
def descargar_docx(id_contrato: int, id_archivo: int, request: Request):
    """Sirve el DOCX convertido desde PDF."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre
            FROM archivos
            WHERE id_contrato = %s AND id_archivo = %s
            LIMIT 1
        """, (id_contrato, id_archivo))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    ruta_local, nombre = row
    ruta = _reparar_ruta(ruta_local)
    if not ruta:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")

    docx_path = ruta.with_suffix('.docx')
    if not docx_path.exists():
        raise HTTPException(status_code=404, detail="DOCX convertido no encontrado")

    return FileResponse(
        path=str(docx_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=docx_path.name,
        headers={"Access-Control-Allow-Origin": "*"}
    )



import subprocess
import tempfile
import shutil
from fastapi.responses import StreamingResponse
from pathlib import Path


@router.get("/{id_contrato}/archivos/{id_archivo}/preview")
def preview_archivo(id_contrato: int, id_archivo: int):
    """Convierte docx a PDF y lo sirve para abrir en navegador."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, extension
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local = row[0]
    extension  = (row[1] or '').lower().strip('.')

    # Reparar ruta dinámica si cambió de usuario/PC
    ruta_check = Path(ruta_local) if ruta_local else None
    if ruta_check and not ruta_check.exists():
        # Ruta relativa nueva (archivos\73469\cotizacion\...)
        ruta_check2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta_check2.exists():
            ruta_local = str(ruta_check2)
        else:
            # Ruta absoluta vieja con otro usuario (C:\Users\MSICROSS\...)
            partes = ruta_check.parts
            try:
                idx        = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa   = Path(*partes[idx+1:])
                ruta_check3 = CARPETA_SALIDA_LOCAL / relativa
                if ruta_check3.exists():
                    ruta_local = str(ruta_check3)
            except StopIteration:
                pass
    if not ruta_local or not Path(ruta_local).exists():
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    if extension == 'pdf':
        return FileResponse(
            path=ruta_local,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"}
        )

    if extension in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        try:
            pdf_path = Path(tmp_dir) / "output.pdf"
            ruta_ps  = ruta_local.replace("'", "\\'")
            pdf_ps   = str(pdf_path).replace("'", "\\'")
            ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=60
            )
            if not pdf_path.exists():
                raise HTTPException(status_code=500, detail=f"Error convirtiendo: {result.stderr}")
            pdf_bytes = pdf_path.read_bytes()
            return StreamingResponse(
                iter([pdf_bytes]),
                media_type="application/pdf",
                headers={"Content-Disposition": "inline"}
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    raise HTTPException(status_code=400, detail="Formato no soportado")


@router.post("/{id_contrato}/archivos/{id_archivo}/indexar")
def indexar_archivo(id_contrato: int, id_archivo: int):
    """Indexa un archivo local al RAG (ChromaDB) y guarda el document_id en BD."""
    import uuid
    from services.ocr_service import extract_text_from_pdf
    from services.embedding_service import process_and_store_document
    from routers.upload import load_registry, save_registry
    from datetime import datetime

    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension, rag_document_id
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local, nombre, extension, rag_document_id = row
    extension = (extension or '').lower().strip('.')

    # Reparar ruta dinámica (misma lógica que preview_archivo / descargar_archivo_local)
    ruta_check = Path(ruta_local) if ruta_local else None
    if ruta_check and not ruta_check.exists():
        ruta_check2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta_check2.exists():
            ruta_local = str(ruta_check2)
        else:
            partes = ruta_check.parts
            try:
                idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa = Path(*partes[idx+1:])
                ruta_check3 = CARPETA_SALIDA_LOCAL / relativa
                if ruta_check3.exists():
                    ruta_local = str(ruta_check3)
            except StopIteration:
                pass

    if not ruta_local or not Path(ruta_local).exists():
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    if rag_document_id:
        return {"document_id": rag_document_id, "already_indexed": True}

    pdf_path = ruta_local
    tmp_dir  = None
    if extension in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        tmp_pdf = Path(tmp_dir) / "output.pdf"
        ruta_ps = ruta_local.replace("'", "\\'")
        pdf_ps  = str(tmp_pdf).replace("'", "\\'")
        ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=60
        )
        if not tmp_pdf.exists():
            raise HTTPException(status_code=500, detail=f"Error convirtiendo DOCX: {result.stderr}")
        pdf_path = str(tmp_pdf)

    try:
        document_id = str(uuid.uuid4())
        safe_name   = (nombre or Path(ruta_local).name).replace(" ", "_")

        pages_data, was_ocr = extract_text_from_pdf(pdf_path)
        if not pages_data:
            raise HTTPException(status_code=500, detail="No se pudo extraer texto del archivo")

        chunks = process_and_store_document(
            pages_data  = pages_data,
            document_id = document_id,
            filename    = safe_name,
            was_ocr     = was_ocr
        )

        registry = load_registry()
        registry[document_id] = {
            "document_id"       : document_id,
            "filename"          : safe_name,
            "original_filename" : nombre or safe_name,
            "pages"             : len(pages_data),
            "chunks"            : chunks,
            "was_ocr"           : was_ocr,
            "status"            : "ready",
            "pdf_path"          : pdf_path,
            "uploaded_at"       : datetime.now().isoformat()
        }
        save_registry(registry)

        conn2 = get_conn()
        cur2  = conn2.cursor()
        try:
            cur2.execute("""
                UPDATE archivos SET rag_document_id = %s
                WHERE id_archivo = %s
            """, (document_id, id_archivo))
            conn2.commit()
        finally:
            cur2.close()
            conn2.close()

        return {"document_id": document_id, "chunks": chunks, "already_indexed": False}

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)



# ─── ONLYOFFICE INTEGRATION ──────────────────────────────────────────────────

from fastapi import Request
from fastapi.responses import JSONResponse
import json

ONLYOFFICE_SERVER = os.getenv("ONLYOFFICE_URL", "http://localhost:8080")
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8000")


SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def _reparar_ruta(ruta_local: str) -> Optional[Path]:
    """Repara rutas dinámicas de archivos."""
    ruta = Path(ruta_local)
    if ruta.exists():
        return ruta
    ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
    if ruta2.exists():
        return ruta2
    partes = ruta.parts
    try:
        idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
        relativa = Path(*partes[idx+1:])
        ruta3 = CARPETA_SALIDA_LOCAL / relativa
        if ruta3.exists():
            return ruta3
    except StopIteration:
        pass
    return None

def _pdf_tiene_texto(pdf_path: Path) -> bool:
    """Retorna True si el PDF tiene texto extraíble (no es escaneado)."""
    try:
        import fitz  # pymupdf
        doc = fitz.open(str(pdf_path))
        for page in doc:
            if page.get_text().strip():
                doc.close()
                return True
        doc.close()
        return False
    except Exception as e:
        logger.error(f"[PDF_CHECK] Error verificando texto: {e}")
        return False
import requests

GOTENBERG_URL = "http://localhost:3001/forms/libreoffice/convert"

def _convertir_pdf_a_docx(pdf_path: Path) -> Optional[Path]:
    """
    Conversión REAL PDF → DOCX usando LibreOffice (Gotenberg).
    Mucho mejor que pdf2docx.
    """

    docx_path = pdf_path.with_suffix(".docx")

    if docx_path.exists():
        return docx_path

    try:
        with open(pdf_path, "rb") as f:
            files = {
                "files": (pdf_path.name, f, "application/pdf")
            }

            response = requests.post(
                GOTENBERG_URL,
                files=files,
                timeout=120
            )

        if response.status_code != 200:
            print("❌ Gotenberg error:", response.text)
            return None

        docx_path.write_bytes(response.content)

        print(f"✓ CONVERTIDO PRO: {docx_path}")
        return docx_path

    except Exception as e:
        print(f"❌ Error conversión Gotenberg: {e}")
        return None



@router.get("/{id_contrato}/archivos/{id_archivo}/onlyoffice-config")
def get_onlyoffice_config(id_contrato: int, id_archivo: int, request: Request, id_cotizacion: Optional[int] = None):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT nombre, extension, ruta_local
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    nombre, extension, ruta_local = row
    ext = (extension or '').lower().strip('.')


    # URL que ve el browser del cliente (para cargar el editor JS)
    host_header = request.headers.get("host", "192.168.1.63:8000")
    backend_url_browser = f"http://{host_header}"
    if ":3000" in backend_url_browser:
        backend_url_browser = backend_url_browser.replace(":3000", ":8000")

    # Si es PDF, convertir a DOCX primero y servir el DOCX
    # PDF → abrir directo en OnlyOffice sin conversión
    # PDF → intentar convertir a DOCX si tiene texto, sino abrir como PDF (solo lectura)
    if ext == 'pdf':
        import time
        callback_url = f"{BACKEND_PUBLIC_URL}/api/contratos/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback"
        key = f"contrato_{id_contrato}_archivo_{id_archivo}_{int(time.time())}"
        download_url = f"{backend_url_browser}/api/contratos/{id_contrato}/archivos/{id_archivo}/descargar"
        if id_cotizacion:
            download_url += f"?id_cotizacion={id_cotizacion}" 
        return {
            "document": {
                "fileType": "pdf",
                "key": key,
                "title": nombre or f"archivo_{id_archivo}.pdf",
                "url": download_url,
                "permissions": {"download": True, "edit": False, "print": True}
            },
            "documentType": "word",
            "editorConfig": {
                "callbackUrl": callback_url,
                "lang": "es",
                "user": {"id": "pladibot-user", "name": "PLADIBOT"},
                "customization": {
                    "autosave": False, "forcesave": False,
                    "logo": {"visible": False},
                    "toolbarNoTabs": True,
                }
            }
        }


    doc_type_map = {
        'docx': 'word', 'doc': 'word',
        'pdf' : 'word',
        'xlsx': 'cell', 'xls': 'cell',
        'pptx': 'slide', 'ppt': 'slide',
    }
    file_type_map = {
        'docx': 'docx', 'doc': 'doc',
        'pdf' : 'pdf',
    }
    doc_type  = doc_type_map.get(ext, 'word')
    file_type = file_type_map.get(ext, ext)

    download_url = f"{backend_url_browser}/api/contratos/{id_contrato}/archivos/{id_archivo}/descargar"
    if id_cotizacion:
        download_url += f"?id_cotizacion={id_cotizacion}"
    callback_url = f"{BACKEND_PUBLIC_URL}/api/contratos/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback"

    import time
    key = f"contrato_{id_contrato}_archivo_{id_archivo}_{int(time.time())}"

    return {
        "document": {
            "fileType" : file_type,
            "key"      : key,
            "title"    : nombre or f"archivo_{id_archivo}.{ext}",
            "url"      : download_url,
            "permissions": {"download": True, "edit": True, "print": True}
        },
        "documentType": doc_type,
        "editorConfig": {
            "callbackUrl": callback_url,
            "lang"       : "es",
            "user"       : {"id": "pladibot-user", "name": "PLADIBOT"},
            "customization": {
                "autosave": True, "forcesave": True,
                "logo": {"visible": False},
                "toolbarNoTabs": True,
            }
        }
    }


@router.post("/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback")
async def onlyoffice_callback(id_contrato: int, id_archivo: int, request: Request):
    """
    OnlyOffice llama aquí cuando el usuario guarda el documento.
    Status 2 = listo para descargar. Descargamos y sobreescribimos el archivo local.
    """
    import httpx

    body = await request.json()
    status = body.get("status")
    logger.info(f"[CALLBACK] status={status} body={body}")

    # Status 2 = documento guardado y listo para descargar
    # Status 6 = forcesave
    if status in (2, 6):
        download_url = body.get("url")
        if not download_url:
            return JSONResponse({"error": 0})

        # Obtener ruta local del archivo
        conn = get_conn()
        cur  = conn.cursor()
        try:
            cur.execute("""
                SELECT ruta_local, nombre, extension
                FROM archivos
                WHERE id_archivo = %s AND id_contrato = %s
                LIMIT 1
            """, (id_archivo, id_contrato))
            row = cur.fetchone()
        finally:
            cur.close()
            conn.close()

        if not row:
            return JSONResponse({"error": 0})

        ruta_local, nombre, extension = row

        # Reparar ruta dinámica
        ruta = Path(ruta_local)
        if not ruta.exists():
            ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
            if ruta2.exists():
                ruta = ruta2
            else:
                partes = ruta.parts
                try:
                    idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                    relativa = Path(*partes[idx+1:])
                    ruta3 = CARPETA_SALIDA_LOCAL / relativa
                    if ruta3.exists():
                        ruta = ruta3
                except StopIteration:
                    pass

        # Descargar el archivo editado desde OnlyOffice y guardar
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(download_url, timeout=30)
                resp.raise_for_status()
                ruta.write_bytes(resp.content)
                logger.info(f"✓ Archivo guardado desde OnlyOffice: {ruta}")
        except Exception as e:
            logger.error(f"Error guardando desde OnlyOffice: {e}")

    # OnlyOffice requiere siempre {"error": 0} para confirmar
    return JSONResponse({"error": 0})


