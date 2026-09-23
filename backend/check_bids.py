"""
check_bids.py
Verifica si la API OCDS del SEACE (contratacionesabiertas.oece.gob.pe)
publica el bloque "bids" (todos los postores + sus precios), o si solo
trae "awards" (solo el ganador).

Uso:
    python check_bids.py                          -> busca procesos con_resultado recientes y los inspecciona
    python check_bids.py <ocid>                    -> inspecciona un ocid puntual
    python check_bids.py <ocid1> <ocid2> ...       -> varios ocids

Requiere: pip install httpx
"""
import sys
import json
import httpx

BASE_URL = "https://contratacionesabiertas.oece.gob.pe/api/v1"


def inspeccionar_release(release: dict):
    ocid = release.get("ocid")
    tender = release.get("tender", {})
    awards = release.get("awards", [])
    bids = release.get("bids")

    print("=" * 90)
    print(f"OCID: {ocid}")
    print(f"Título/Nomenclatura: {tender.get('title')}")
    print(f"Claves top-level del release: {sorted(release.keys())}")

    # --- AWARDS: lo que tu script YA guarda (solo ganador) ---
    print(f"\n[awards] {len(awards)} award(s) encontrados (esto es lo que TU script guarda):")
    for a in awards:
        suppliers = a.get("suppliers", []) or []
        nombres = [s.get("name") for s in suppliers]
        valor = a.get("value", {})
        print(f"  - award id={a.get('id')} status={a.get('status')} "
              f"proveedor(es)={nombres} monto={valor.get('amount')} {valor.get('currency')}")

    # --- BIDS: lo que necesitas para ver a TODOS los postores ---
    if bids is None:
        print("\n[bids] ❌ Este release NO trae el campo 'bids' en absoluto.")
        print("        -> SEACE no está publicando el detalle de ofertas perdedoras para este proceso.")
    else:
        details = bids.get("details", [])
        stats = bids.get("statistics", [])
        print(f"\n[bids] ✅ El release SÍ trae bloque 'bids'.")
        print(f"        statistics: {stats}")
        print(f"        {len(details)} oferta(s) individuales encontradas:")
        for d in details:
            tenderers = d.get("tenderers", []) or []
            nombres = [t.get("name") for t in tenderers]
            valor = d.get("value", {}) or {}
            print(f"        - bid id={d.get('id')} status={d.get('status')} "
                  f"postor(es)={nombres} monto={valor.get('amount')} {valor.get('currency')}")

    # --- PARTIES: a veces algunos publicadores OCDS meten aquí a TODOS
    # los participantes (con roles=["tenderer"]) aunque no llenen "bids".
    # Vale la pena chequearlo antes de descartar la API por completo.
    parties = release.get("parties", []) or []
    print(f"\n[parties] {len(parties)} party(s) en el release:")
    for p in parties:
        print(f"  - name={p.get('name')!r} roles={p.get('roles')}")

    print()


def buscar_con_resultado(limit=5):
    """Trae algunos releases recientes y filtra los que ya tienen awards (con_resultado)."""
    print(f"Buscando hasta {limit} procesos recientes con resultado...\n")
    url = f"{BASE_URL}/releasesAfter"
    params = {
        "sourceId": "seace_v3",
        "startDate": "2026-01-01",
        "endDate": "2026-09-22",
        "size": 100,
    }
    encontrados = []
    with httpx.Client(timeout=30) as client:
        while url and len(encontrados) < limit:
            r = client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            for rel in data.get("releases", []):
                if rel.get("awards"):
                    encontrados.append(rel)
                    if len(encontrados) >= limit:
                        break
            next_url = data.get("links", {}).get("next")
            url, params = (next_url, None) if next_url else (None, None)
    return encontrados


def buscar_por_ocid(ocid: str):
    # el endpoint de release individual usa el ocid completo como parte de la URL
    url = f"{BASE_URL}/release/{ocid}"
    with httpx.Client(timeout=30) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.json()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        for ocid in sys.argv[1:]:
            try:
                release = buscar_por_ocid(ocid)
                inspeccionar_release(release)
            except Exception as e:
                print(f"Error consultando {ocid}: {e}")
    else:
        releases = buscar_con_resultado(limit=5)
        if not releases:
            print("No se encontraron procesos con_resultado en el rango buscado. Ajusta startDate/endDate.")
        for rel in releases:
            inspeccionar_release(rel)