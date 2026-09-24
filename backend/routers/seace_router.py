"""
seace_router.py
Expone las convocatorias vigentes del SEACE (sincronizadas por seace_sync.py
y por seace_scrape_live.py) para el módulo Postulaciones/Cotizar en SEACE
del frontend.

CAMBIOS respecto a tu versión anterior:
  - listar_vigentes() ahora acepta `entidad` como filtro APARTE de `q`
    (antes `q` buscaba en título O entidad a la vez; ahora `q` busca
    solo en título/descripción y `entidad` filtra por entidad, para
    que la barra de filtros del frontend tenga los dos campos
    independientes, igual que en la imagen de referencia).
  - Nuevo endpoint GET /api/seace/kpis: cuenta convocatorias vigentes
    agrupadas por `categoria` (Bienes/Servicios/Obras/Consultoría de
    obra — el "objeto de contratación"), para las tarjetas KPI de la
    parte de arriba del dashboard.
"""
import os
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import FileResponse

load_dotenv()
DOCS_DIR = os.path.abspath(os.getenv("SEACE_DOCS_DIR", "seace_docs"))
from mysql.connector import connect
from db import get_db

router = APIRouter(prefix="/api/seace", tags=["SEACE"])

from seace_postores_service import obtener_cache, disparar_refresco


@router.get("/vigentes")
async def listar_vigentes(
    modalidad: str | None = Query(None),
    categoria: str | None = Query(None),
    estado: str | None = Query(None),
    q: str | None = Query(None, description="Busca en título o descripción"),
    entidad: str | None = Query(None, description="Filtra por nombre de entidad"),
    region: str | None = Query(None, description="Filtra por región"),
    departamento: str | None = Query(None, description="Filtra por departamento"),
    distrito: str | None = Query(None, description="Filtra por distrito"),
    monto_min: float | None = Query(None),
    monto_max: float | None = Query(None),
    solo_desierto: bool = Query(False),
    orden: str = Query("reciente", description="reciente | urgencia | monto_desc | monto_asc | recien_extraido"),
    limit: int = Query(30, le=100),
    offset: int = Query(0),
    conn=Depends(get_db),
):
    where = []
    params = []

    if estado:
        where.append("estado = %s")
        params.append(estado)

    if modalidad:
        where.append("modalidad = %s")
        params.append(modalidad)

    if categoria:
        where.append("categoria = %s")
        params.append(categoria)

    if q:
        # FULLTEXT en modo booleano con comodín al final ('word*') sí usa
        # índice — a diferencia de LIKE '%word%' que fuerza un table scan
        # completo. tender_id se queda con LIKE porque suele ser un código
        # corto (poco costoso) y no siempre calza bien con FULLTEXT.
        palabras = " ".join(f"+{p}*" for p in q.split() if p)
        where.append("(MATCH(titulo, descripcion, nomenclatura, entidad) AGAINST (%s IN BOOLEAN MODE) OR tender_id LIKE %s)")
        params += [palabras, f"%{q}%"]

    if entidad:
        palabras_entidad = " ".join(f"+{p}*" for p in entidad.split() if p)
        where.append("MATCH(titulo, descripcion, nomenclatura, entidad) AGAINST (%s IN BOOLEAN MODE)")
        params.append(palabras_entidad)

    if region:
        where.append("region = %s")
        params.append(region)

    if departamento:
        where.append("departamento = %s")
        params.append(departamento)

    if distrito:
        where.append("distrito = %s")
        params.append(distrito)

    if monto_min is not None:
        where.append("monto >= %s")
        params.append(monto_min)

    if monto_max is not None:
        where.append("monto <= %s")
        params.append(monto_max)

    if solo_desierto:
        where.append("tiene_indicio_desierto = 1")

    where_sql = " AND ".join(where)
    if where_sql:
        where_sql = f"WHERE {where_sql}"

    orden_sql = {
        "urgencia": "(fecha_fin_consultas IS NULL) ASC, fecha_fin_consultas ASC",
        "monto_desc": "(monto IS NULL) ASC, monto DESC",
        "monto_asc": "(monto IS NULL) ASC, monto ASC",
        "reciente": "published_date DESC, fecha_convocatoria DESC",
        "recien_extraido": "scraped_at DESC",
    }.get(orden, "published_date DESC, fecha_convocatoria DESC")

    cur = conn.cursor(dictionary=True)

    # Conteo aparte: sin filtros es carísimo contar 562k filas exactas
    # en cada carga. Solo cuando NO hay filtros usamos un valor aproximado
    # instantáneo (TABLE_ROWS de information_schema); con filtros sí
    # contamos exacto, porque ahí el WHERE reduce mucho el universo.
    if not where_sql:
        cur.execute(
            "SELECT TABLE_ROWS AS total FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seace_procesos'"
        )
        total = cur.fetchone()["total"]
    else:
        cur.execute(f"SELECT COUNT(*) AS total FROM seace_procesos {where_sql}", params)
        total = cur.fetchone()["total"]

    cur.execute(
        f"""
        SELECT
            ocid,
            tender_id,
            nomenclatura,
            titulo,
            entidad,
            region,
            departamento,
            distrito,
            modalidad,
            categoria,
            fecha_convocatoria,
            fecha_fin_consultas,
            monto,
            tiene_indicio_desierto,
            published_date,
            scraped_at,
            origen,
            estado
        FROM seace_procesos
        {where_sql}
        ORDER BY {orden_sql}
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )
    rows = cur.fetchall()

    cur.close()
    return {"total": total, "items": rows}


@router.get("/kpis")
async def kpis_seace(estado: str | None = Query("vigente"), conn=Depends(get_db)):
    """Tarjetas KPI: total de convocatorias y desglose por objeto de
    contratación (categoria = goods/services/works/consultoriadeobra),
    para pintar arriba del listado. `estado=None` trae el total histórico."""
    where_sql = ""
    params: list = []
    if estado:
        where_sql = "WHERE estado = %s"
        params.append(estado)

    cur = conn.cursor(dictionary=True)

    cur.execute(
        f"""
        SELECT
            COALESCE(categoria, 'sin_clasificar') AS categoria,
            COUNT(*) AS total,
            SUM(monto) AS monto_total
        FROM seace_procesos
        {where_sql}
        GROUP BY COALESCE(categoria, 'sin_clasificar')
        """,
        params,
    )
    por_categoria = cur.fetchall()

    cur.execute(f"SELECT COUNT(*) AS total, SUM(monto) AS monto_total FROM seace_procesos {where_sql}", params)
    totales = cur.fetchone()

    cur.close()

    return {
        "total": totales["total"] or 0,
        "monto_total": float(totales["monto_total"]) if totales["monto_total"] else 0.0,
        "por_categoria": [
            {
                "categoria": fila["categoria"],
                "total": fila["total"],
                "monto_total": float(fila["monto_total"]) if fila["monto_total"] else 0.0,
            }
            for fila in por_categoria
        ],
    }



@router.get("/ubicaciones")
async def listar_ubicaciones(conn=Depends(get_db)):
    """Regiones/departamentos/distritos distintos ya presentes en la
    base, para poblar los selects de filtro geográfico del frontend."""
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT DISTINCT region FROM seace_procesos WHERE region IS NOT NULL ORDER BY region"
    )
    regiones = [r["region"] for r in cur.fetchall()]

    cur.execute(
        "SELECT DISTINCT departamento FROM seace_procesos WHERE departamento IS NOT NULL ORDER BY departamento"
    )
    departamentos = [r["departamento"] for r in cur.fetchall()]

    cur.execute(
        "SELECT DISTINCT distrito FROM seace_procesos WHERE distrito IS NOT NULL ORDER BY distrito"
    )
    distritos = [r["distrito"] for r in cur.fetchall()]

    cur.close()
    return {"regiones": regiones, "departamentos": departamentos, "distritos": distritos}



@router.get("/kpis-estados")
async def kpis_estados(conn=Depends(get_db)):
    """Conteo total de procesos por estado (vigente/con_resultado/vencido),
    sin filtrar por fecha — para las tarjetas resumen de arriba."""
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT estado, COUNT(*) AS total
        FROM seace_procesos
        GROUP BY estado
        """
    )
    rows = cur.fetchall()
    cur.close()

    resultado = {"vigente": 0, "con_resultado": 0, "vencido_sin_resultado": 0}
    for r in rows:
        if r["estado"] in resultado:
            resultado[r["estado"]] = r["total"]
    resultado["total"] = sum(resultado.values())
    return resultado

@router.get("/{ocid}")
async def detalle_proceso(ocid: str, conn=Depends(get_db)):
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM seace_procesos WHERE ocid = %s", (ocid,))
    row = cur.fetchone()
    cur.close()
    return row


@router.get("/{ocid}/adjudicacion")
async def obtener_adjudicacion(ocid: str, conn=Depends(get_db)):
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT ocid, proveedor, proveedor_ruc, monto, moneda,
               fecha_adjudicacion, estado_award
        FROM seace_adjudicaciones
        WHERE ocid = %s
        ORDER BY monto DESC
        LIMIT 1
        """,
        (ocid,),
    )
    fila = cur.fetchone()
    cur.close()
    if not fila:
        raise HTTPException(status_code=404, detail="Sin adjudicación registrada")
    return fila


import httpx

BASE_OCDS = "https://contratacionesabiertas.oece.gob.pe/api/v1"

@router.get("/detalle-completo/{ocid:path}")
async def detalle_completo(ocid: str, conn=Depends(get_db)):
    """
    Si el proceso viene del scraper en vivo (origen='scraper'), su ocid
    no existe en la API OCDS — se arma el detalle desde seace_detalle_ficha
    y seace_documentos, que es donde seace_scrape_live.py guarda lo que
    extrae de la Ficha de Selección. Si viene de la sincronización con la
    API (origen='api'), se sigue pidiendo en vivo a OCDS como antes.
    """
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT origen, titulo, entidad FROM seace_procesos WHERE ocid = %s", (ocid,))
    proceso = cur.fetchone()

    if proceso and proceso["origen"] == "scraper":
        cur.execute(
            """
            SELECT tipo_compra_seleccion, normativa_aplicable, entidad_convocante,
                   direccion_legal, pagina_web, telefono_entidad,
                   monto_derecho_participacion, fecha_hora_publicacion_detalle,
                   descripcion_objeto_completa
            FROM seace_detalle_ficha
            WHERE ocid = %s
            """,
            (ocid,),
        )
        ficha = cur.fetchone()

        cur.execute(
            """
            SELECT nro, etapa, documento, archivo, fecha_publicacion, ruta_local
            FROM seace_documentos
            WHERE ocid = %s
            ORDER BY nro
            """,
            (ocid,),
        )
        documentos = cur.fetchall()
        cur.close()

        if not ficha:
            return {"error": "Aún no se procesó la Ficha de Selección de este proceso"}

        return {
            "tender": {
                "title": proceso["titulo"],
                "description": ficha["descripcion_objeto_completa"] or proceso["titulo"],
            },
            "buyer": {"name": ficha["entidad_convocante"] or proceso["entidad"]},
            "parties": [
                {
                    "address": {"streetAddress": ficha["direccion_legal"]} if ficha["direccion_legal"] else None,
                    "contactPoint": {"telephone": ficha["telefono_entidad"]} if ficha["telefono_entidad"] else None,
                }
            ],
            "detalle_ficha": ficha,
            "documentos_scraper": documentos,
        }

    cur.close()

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{BASE_OCDS}/record/{ocid}")

        if r.status_code == 404:
            return {"error": "No encontrado en el portal OCDS"}

        r.raise_for_status()
        data = r.json()

    records = data.get("records", [])

    if not records:
        return {"error": "Sin datos"}

    compiled = records[0].get("compiledRelease", {})

    return compiled



@router.get("/cronograma/{tender_id:path}")
async def obtener_cronograma(tender_id: str, conn=Depends(get_db)):
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT etapa, fecha_inicio, fecha_fin, es_etapa_actual
        FROM seace_cronograma_fases
        WHERE tender_id = %s
        ORDER BY id
        """,
        (tender_id,),
    )
    rows = cur.fetchall()
    cur.close()
    return {"tender_id": tender_id, "fases": rows}


@router.get("/documento/{ocid}/{nro}")
async def descargar_documento(ocid: str, nro: str, conn=Depends(get_db)):
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT ruta_local FROM seace_documentos WHERE ocid = %s AND nro = %s LIMIT 1",
        (ocid, nro),
    )
    fila = cur.fetchone()
    cur.close()

    if not fila or not fila["ruta_local"]:
        raise HTTPException(status_code=404, detail="Documento no disponible")

    ruta = os.path.abspath(os.path.join(DOCS_DIR, fila["ruta_local"]))
    # evita que alguien salga de la carpeta de documentos
    if not ruta.startswith(DOCS_DIR + os.sep) or not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en el servidor")

    return FileResponse(ruta, filename=os.path.basename(ruta), content_disposition_type="inline")




@router.get("/{ocid}/postores")
async def get_postores(ocid: str, nomenclatura: str):
    cache = obtener_cache(ocid)
    if cache["estado"] == "pendiente":
        return disparar_refresco(ocid, nomenclatura)
    return cache


@router.post("/{ocid}/postores/refrescar")
async def refrescar_postores(ocid: str, nomenclatura: str):
    return disparar_refresco(ocid, nomenclatura)


@router.get("/documento-postor/{ocid}/{ruc}/{nombre}")
async def descargar_documento_postor(ocid: str, ruc: str, nombre: str, conn=Depends(get_db)):
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT ruta_local FROM seace_postores_documentos WHERE ocid = %s AND ruc = %s AND nombre = %s LIMIT 1",
        (ocid, ruc, nombre),
    )
    fila = cur.fetchone()
    cur.close()

    if not fila or not fila["ruta_local"]:
        raise HTTPException(status_code=404, detail="Documento no disponible")

    ruta = os.path.abspath(os.path.join(DOCS_DIR, fila["ruta_local"]))
    if not ruta.startswith(DOCS_DIR + os.sep) or not os.path.isfile(ruta):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en el servidor")

    return FileResponse(ruta, filename=os.path.basename(ruta), content_disposition_type="inline")


@router.get("/{ocid}/comparables")
async def get_comparables(ocid: str, conn=Depends(get_db)):
    """Proveedores que ganaron procesos con la misma clasificación
    UNSPSC/CUBSO que los ítems de este proceso, para sugerir precio."""
    cur = conn.cursor(dictionary=True)

    cur.execute(
        """SELECT DISTINCT clasificacion_unspsc, clasificacion_cubso
           FROM seace_items
           WHERE ocid = %s AND origen_item = 'tender'
             AND (clasificacion_unspsc IS NOT NULL OR clasificacion_cubso IS NOT NULL)""",
        (ocid,),
    )
    clasificaciones = cur.fetchall()

    if not clasificaciones:
        cur.close()
        return {"comparables": []}

    codigos_unspsc = [c["clasificacion_unspsc"] for c in clasificaciones if c["clasificacion_unspsc"]]
    codigos_cubso = [c["clasificacion_cubso"] for c in clasificaciones if c["clasificacion_cubso"]]

    condiciones = []
    params = []
    if codigos_unspsc:
        condiciones.append(f"i.clasificacion_unspsc IN ({','.join(['%s'] * len(codigos_unspsc))})")
        params += codigos_unspsc
    if codigos_cubso:
        condiciones.append(f"i.clasificacion_cubso IN ({','.join(['%s'] * len(codigos_cubso))})")
        params += codigos_cubso

    where_clasif = " OR ".join(condiciones)

    cur.execute(
        f"""
        SELECT p.ocid, p.nomenclatura, p.entidad, i.descripcion, i.proveedor,
               i.proveedor_ruc, i.precio_unitario, i.cantidad, i.unidad,
               i.fecha_adjudicacion
        FROM seace_items i
        JOIN seace_procesos p ON p.ocid = i.ocid
        WHERE i.origen_item = 'award'
          AND i.ocid != %s
          AND i.precio_unitario IS NOT NULL
          AND ({where_clasif})
        ORDER BY i.fecha_adjudicacion DESC
        LIMIT 10
        """,
        [ocid] + params,
    )
    comparables = cur.fetchall()
    cur.close()
    return {"comparables": comparables}