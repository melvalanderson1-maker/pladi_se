"""
ocr_service.py
Detecta si un PDF es imagen escaneada o tiene texto digital.
Si es escaneado → aplica Tesseract OCR página por página.
Si es texto → extrae con pymupdf directamente.
"""
import os
import fitz  # pymupdf
import pytesseract
from pdf2image import convert_from_path
from PIL import Image
import logging

logger = logging.getLogger(__name__)

# En Windows, Tesseract necesita la ruta completa
# Descomenta y ajusta si estás en Windows:
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'


def is_page_scanned(page: fitz.Page, min_text_length: int = 50) -> bool:
    """
    Determina si una página es imagen escaneada.
    Si tiene menos de 50 caracteres de texto → probablemente es imagen.
    """
    text = page.get_text().strip()
    return len(text) < min_text_length


def extract_text_from_pdf(pdf_path: str) -> tuple[list[dict], bool]:
    """
    Extrae texto de un PDF, página por página.
    
    Returns:
        pages_data: Lista de dicts con {page_num, text, was_ocr}
        any_ocr_used: True si al menos una página requirió OCR
    """
    pages_data = []
    any_ocr_used = False
    
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    
    logger.info(f"Procesando PDF: {pdf_path} ({total_pages} páginas)")
    
    for page_num in range(total_pages):
        page = doc[page_num]
        
        if is_page_scanned(page):
            # Esta página es imagen → usar OCR
            logger.info(f"  Página {page_num + 1}: escaneada, aplicando OCR...")
            text = _ocr_single_page(pdf_path, page_num)
            was_ocr = True
            any_ocr_used = True
        else:
            # Esta página tiene texto digital → extraer directo
            logger.info(f"  Página {page_num + 1}: texto digital, extrayendo...")
            text = page.get_text()
            was_ocr = False
        
        # Limpiar el texto
        text = _clean_text(text)
        
        if text.strip():  # Solo agregar si hay contenido
            pages_data.append({
                "page_num": page_num + 1,  # 1-indexed para el usuario
                "text": text,
                "was_ocr": was_ocr
            })
    
    doc.close()
    
    logger.info(f"Extracción completa. OCR usado: {any_ocr_used}. Páginas con contenido: {len(pages_data)}")
    return pages_data, any_ocr_used


def _ocr_single_page(pdf_path: str, page_num: int) -> str:
    """
    Convierte una página a imagen y aplica Tesseract OCR.
    page_num es 0-indexed.
    """
    try:
        # Convertir la página específica a imagen de alta resolución
        images = convert_from_path(
            pdf_path,
            first_page=page_num + 1,
            last_page=page_num + 1,
            dpi=300,
            poppler_path=r'C:\poppler\Library\bin'
        )
        if not images:
            logger.warning(f"No se pudo convertir página {page_num + 1} a imagen")
            return ""
        
        image = images[0]
        
        # Aplicar OCR con español e inglés
        # lang='spa+eng' = prueba ambos idiomas
        text = pytesseract.image_to_string(
            image,
            lang='spa+eng',             # Español + inglés
            config='--psm 1'            # psm 1 = detección automática de orientación
        )
        
        return text
        
    except Exception as e:
        logger.error(f"Error en OCR página {page_num + 1}: {e}")
        logger.error("¿Está Tesseract instalado? Consulta el README.")
        return ""


def _clean_text(text: str) -> str:
    """Limpia el texto extraído: quita espacios extra, líneas vacías múltiples."""
    if not text:
        return ""
    
    lines = text.split('\n')
    
    # Quitar líneas que son solo espacios
    lines = [line.strip() for line in lines]
    
    # Reducir múltiples líneas vacías a una sola
    cleaned_lines = []
    prev_empty = False
    for line in lines:
        if not line:
            if not prev_empty:
                cleaned_lines.append("")
            prev_empty = True
        else:
            cleaned_lines.append(line)
            prev_empty = False
    
    return '\n'.join(cleaned_lines).strip()


def get_pdf_page_count(pdf_path: str) -> int:
    """Retorna el número de páginas de un PDF."""
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count
