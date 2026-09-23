# GUÍA DE INICIO — Paso a paso

## PREREQUISITOS
Antes de empezar necesitas tener instalado:
- Python 3.10 o superior → https://python.org
- Node.js 18 o superior → https://nodejs.org
- Git (opcional)

---

## PASO 1 — Instalar Tesseract OCR

### Windows:
1. Ir a: https://github.com/UB-Mannheim/tesseract/wiki
2. Descargar "tesseract-ocr-w64-setup-5.x.x.exe"
3. Instalar con las opciones por defecto
4. Durante la instalación, marcar "Additional language data (download)" → seleccionar "spa" (español)
5. El instalador agrega Tesseract al PATH automáticamente
6. Verificar con: tesseract --version

### Mac:
   brew install tesseract tesseract-lang

### Ubuntu/Linux:
   sudo apt-get update
   sudo apt-get install tesseract-ocr tesseract-ocr-spa poppler-utils

---

## PASO 2 — Configurar el Backend

Abre una terminal en la carpeta del proyecto:

   cd rag-docs/backend

### Crear entorno virtual Python:
   # Windows:
   python -m venv venv
   venv\Scripts\activate

   # Mac/Linux:
   python3 -m venv venv
   source venv/bin/activate

### Instalar dependencias:
   pip install -r requirements.txt

   NOTA: La primera vez tarda 5-10 minutos.
   Se instalará PyTorch (~700MB) y las librerías de IA.

### Configurar variables de entorno:
   # Copiar el archivo de ejemplo:
   # Windows:
   copy .env.example .env
   # Mac/Linux:
   cp .env.example .env

   # Abrir .env con cualquier editor y poner tu API key de OpenAI:
   OPENAI_API_KEY=sk-proj-TU_KEY_AQUI

   Obtener API key en: https://platform.openai.com/api-keys
   Crear cuenta → API Keys → Create new secret key

### Iniciar el backend:
   uvicorn main:app --reload --port 8000

   Deberías ver:
   ✓ Modelo de embeddings listo
   ✓ OpenAI API key encontrada
   ✓ Servidor listo en http://localhost:8000

   Prueba que funciona: abrir http://localhost:8000/docs en el navegador

---

## PASO 3 — Configurar el Frontend

Abre UNA NUEVA terminal (deja el backend corriendo):

   cd rag-docs/frontend

### Instalar dependencias:
   npm install

### Iniciar el frontend:
   npm run dev

   Deberías ver:
   ▲ Next.js 14.x.x
   - Local: http://localhost:3000

### Abrir la aplicación:
   Ir a http://localhost:3000 en el navegador

---

## PASO 4 — Usar la aplicación

1. En el panel izquierdo, haz clic o arrastra un PDF para subirlo
2. Espera a que se procese (puedes ver el progreso)
   - PDFs digitales: 5-30 segundos
   - PDFs escaneados (OCR): 1-5 minutos dependiendo del tamaño
3. Cuando aparezca el documento en la lista, haz clic en él (o deja "Todos")
4. Escribe tu pregunta en el chat y presiona Enter
5. La respuesta llega en tiempo real con las páginas de origen

---

## COSTOS APROXIMADOS

OpenAI GPT-4o-mini:
- Input: $0.00015 por 1000 tokens
- Output: $0.0006 por 1000 tokens
- Una pregunta típica con contexto ≈ $0.001 (menos de un centavo)
- 1000 preguntas ≈ $1 dólar

Embeddings (sentence-transformers): GRATIS, corre en tu CPU

ChromaDB: GRATIS, guarda todo en disco local

---

## ESTRUCTURA DE ARCHIVOS GENERADOS

Después de usar la app, verás estas carpetas creadas automáticamente:
   backend/
   ├── uploads/          # Los PDFs que subiste
   ├── chroma_db/        # Base de datos vectorial (embeddings)
   └── documents_registry.json  # Índice de documentos

---

## ERRORES COMUNES

### "tesseract is not installed"
   → Instala Tesseract siguiendo el Paso 1
   → En Windows: descomenta la línea en ocr_service.py con la ruta

### "OPENAI_API_KEY no configurada"
   → Edita backend/.env y agrega tu key

### "ModuleNotFoundError"
   → Asegúrate de tener el entorno virtual activado (venv\Scripts\activate)

### "Connection refused" desde el frontend
   → Verifica que el backend esté corriendo en puerto 8000
   → El next.config.js redirige /api/* → localhost:8000

### OCR muy lento
   → Normal en la primera página, las siguientes son más rápidas
   → Para PDFs muy grandes, considera dividirlos

---

## PARA PRODUCCIÓN (después de desarrollo)

Cuando quieras desplegarlo:
1. Backend: Railway.app o Render.com (plan gratis disponible)
2. Frontend: Vercel (gratis para Next.js)
3. Vector DB: Pinecone (plan gratis) en vez de ChromaDB local
4. Cambiar CORS en main.py para tu dominio de producción
