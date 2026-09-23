import requests
import json

r = requests.get(
    "https://contratacionesabiertas.oece.gob.pe/api/v1/files",
    params={"source": "seace_v3", "page": 1},
)
print(r.status_code)
print(json.dumps(r.json(), indent=2, ensure_ascii=False))