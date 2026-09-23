"""
gemini_rellenar_documento.py
Rellena automáticamente los campos de un formato .docx de cotización
usando datos de la empresa que cotiza y del contrato, vía Gemini.
Contrato de salida: {"fuente": "gemini"|"sin_relleno", "campos_rellenados": int, "error": str|None}
"""
import os
import json
import logging

from docx import Document
from google import genai
from google.genai import types

logger = logging.getLogger("helbot.gemini_rellenar_documento")

# Reusa la misma lista de modelos que ya validaste en gemini_productos.py
MODELOS_CANDIDATOS = [
    m.strip() for m in os.getenv(
        "LLM_MODELOS_RELLENO_GEMINI",
        os.getenv(
            "LLM_MODELOS_PRODUCTOS_GEMINI",
            "gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.5-flash-lite,gemini-3-flash-preview",
        ),
    ).split(",") if m.strip()
]

_cliente = None


def get_client() -> genai.Client:
    global _cliente
    if _cliente is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY no está configurada en el .env")
        _cliente = genai.Client(api_key=api_key)
    return _cliente


SYSTEM_PROMPT = """Eres un asistente que rellena formatos de cotización del Estado peruano.
Recibirás una lista de fragmentos de texto del documento (párrafos y celdas de tabla), cada uno con un "id",
y los DATOS DISPONIBLES: datos de la empresa que cotiza y datos del contrato que se está cotizando.

Tu tarea: para cada fragmento que sea una ETIQUETA con espacio en blanco para completar
(ej: "RUC:", "Razón Social:", "Dirección:", "Representante legal:", "Correo:", "Teléfono:",
"Objeto del contrato:", "Entidad:", "Monto:"), determina si algún dato disponible corresponde.

Devuelve SOLO un JSON, sin texto adicional, con este formato exacto:
{"rellenos": [{"id": <id del fragmento>, "valor": "<texto a insertar>"}]}

Reglas estrictas:
- Solo incluye un "id" cuando SÍ encontraste un dato correspondiente en DATOS DISPONIBLES.
- NUNCA inventes datos que no estén en DATOS DISPONIBLES.
- Etiquetas de la EMPRESA (razón social, RUC, dirección, representante, correo, celular) → usa "empresa".
- Etiquetas del CONTRATO (objeto, entidad, número de proceso, monto referencial) → usa "contrato".
"""


def _extraer_fragmentos(doc: Document) -> list[dict]:
    fragmentos = []
    for idx, p in enumerate(doc.paragraphs):
        texto = p.text.strip()
        if texto:
            fragmentos.append({"id": idx, "texto": texto, "tipo": "parrafo"})
    for t_idx, tabla in enumerate(doc.tables):
        for r_idx, fila in enumerate(tabla.rows):
            for c_idx, celda in enumerate(fila.cells):
                texto = celda.text.strip()
                if texto:
                    fragmentos.append({"id": f"t{t_idx}_r{r_idx}_c{c_idx}", "texto": texto, "tipo": "celda"})
    return fragmentos


def _aplicar_rellenos(doc: Document, rellenos: dict) -> None:
    for idx, p in enumerate(doc.paragraphs):
        if idx in rellenos and p.runs:
            p.runs[0].text = p.runs[0].text.rstrip() + " " + rellenos[idx]
            for r in p.runs[1:]:
                r.text = ""
    for t_idx, tabla in enumerate(doc.tables):
        for r_idx, fila in enumerate(tabla.rows):
            for c_idx, celda in enumerate(fila.cells):
                key = f"t{t_idx}_r{r_idx}_c{c_idx}"
                if key in rellenos:
                    for p in celda.paragraphs:
                        if p.runs:
                            p.runs[0].text = p.runs[0].text.rstrip() + " " + rellenos[key]
                            for r in p.runs[1:]:
                                r.text = ""
                            break


async def rellenar_documento(ruta_entrada: str, ruta_salida: str, datos_empresa: dict, datos_contrato: dict) -> dict:
    doc = Document(ruta_entrada)
    fragmentos = _extraer_fragmentos(doc)

    contenido = json.dumps(
        {"empresa": datos_empresa, "contrato": datos_contrato, "fragmentos": fragmentos},
        ensure_ascii=False,
    )

    client = get_client()
    ultimo_error = None
    for modelo in MODELOS_CANDIDATOS:
        try:
            resp = client.models.generate_content(
                model=modelo,
                contents=contenido,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    temperature=0,
                ),
            )
            data = json.loads(resp.text)
            # las keys que son numéricas (párrafos) vuelven a convertirse a int
            rellenos = {}
            for r in data.get("rellenos", []):
                k = r["id"]
                rellenos[int(k)] = r["valor"] if not str(k).startswith("t") else r["valor"]
            # separa índices numéricos (párrafos) de strings (celdas) sin romper _aplicar_rellenos
            rellenos_finales = {}
            for r in data.get("rellenos", []):
                k = r["id"]
                rellenos_finales[k if isinstance(k, str) and k.startswith("t") else int(k)] = r["valor"]

            _aplicar_rellenos(doc, rellenos_finales)
            doc.save(ruta_salida)
            return {"fuente": "gemini", "modelo": modelo, "campos_rellenados": len(rellenos_finales), "error": None}
        except Exception as e:
            ultimo_error = e
            logger.warning(f"[gemini_rellenar] Falló {modelo}: {e}")
            continue

    doc.save(ruta_salida)  # copia sin rellenar, para no romper el flujo del editor
    return {"fuente": "sin_relleno", "campos_rellenados": 0, "error": str(ultimo_error)}