import httpx
r = httpx.get(
    "https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter",
    params={"sourceId": "seace_v3", "startDate": "2026-08-16", "endDate": "2026-08-31", "size": 1},
)
import json
print(json.dumps(r.json()["releases"][0], indent=2, ensure_ascii=False))