"""
seace_adjudicaciones_backfill.py
Recorre seace_procesos (origen='api', estado='con_resultado') y llena
seace_adjudicaciones desde el raw_json ya guardado. Correr UNA sola vez.
    python seace_adjudicaciones_backfill.py
"""
import json
from seace_sync import get_conn, upsert_adjudicaciones

def backfill():
    conn = get_conn()
    cur = conn.cursor(buffered=True)
    cur.execute("SELECT raw_json FROM seace_procesos WHERE estado='con_resultado' AND origen='api'")
    filas = cur.fetchall()
    cur.close()
    print(f"{len(filas)} procesos con resultado encontrados")
    for i, (raw,) in enumerate(filas, 1):
        upsert_adjudicaciones(conn, json.loads(raw))
        if i % 200 == 0:
            conn.commit()
            print(f"  {i}/{len(filas)}...")
    conn.commit()
    conn.close()
    print("listo")

if __name__ == "__main__":
    backfill()