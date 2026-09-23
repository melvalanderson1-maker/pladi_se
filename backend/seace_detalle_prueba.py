import os, json, urllib.parse
import httpx
from mysql.connector import connect
from dotenv import load_dotenv

load_dotenv()

conn = connect(
    host=os.getenv("MYSQL_HOST", "localhost"), port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.getenv("MYSQL_USER"),
    password=os.getenv("MYSQL_PASSWORD"),
    database=os.getenv("MYSQL_DATABASE"),
)
cur = conn.cursor()
cur.execute("SELECT ocid, tender_id FROM seace_procesos WHERE estado='vigente' ORDER BY updated_at DESC LIMIT 1")
row = cur.fetchone()
cur.close()
conn.close()

if not row:
    raise SystemExit("No hay ningún proceso con estado='vigente' en la tabla. Revisa la tabla seace_procesos.")

ocid, tender_id = row
print("OCID real sacado de tu BD:", ocid)
print("TENDER_ID:", tender_id)
print()

# Intento 1: /release/{id} tal cual (sin encodear)
url1 = f"https://contratacionesabiertas.oece.gob.pe/api/v1/release/{ocid}"
r1 = httpx.get(url1, timeout=30)
print("Intento 1 ->", url1)
print("Status:", r1.status_code)
print(r1.text[:300])
print()

# Intento 2: mismo id pero URL-encodeado (por los ":" del timestamp que trae el ocid)
url2 = f"https://contratacionesabiertas.oece.gob.pe/api/v1/release/{urllib.parse.quote(ocid, safe='')}"
r2 = httpx.get(url2, timeout=30)
print("Intento 2 (encodeado) ->", url2)
print("Status:", r2.status_code)
print(r2.text[:300])
print()

# Intento 3: endpoint alterno /release/{sourceId}/{tenderId}
url3 = f"https://contratacionesabiertas.oece.gob.pe/api/v1/release/seace_v3/{tender_id}"
r3 = httpx.get(url3, timeout=30)
print("Intento 3 (sourceId/tenderId) ->", url3)
print("Status:", r3.status_code)
print(r3.text[:500])

# Guarda el que sí haya funcionado
for name, r in [("intento1", r1), ("intento2", r2), ("intento3", r3)]:
    if r.status_code == 200 and '"error": true' not in r.text and '"error":true' not in r.text:
        with open(f"release_debug_{name}.json", "w", encoding="utf-8") as f:
            json.dump(r.json(), f, ensure_ascii=False, indent=2)
        print(f"\n✅ Guardado release_debug_{name}.json — revisa ese archivo")