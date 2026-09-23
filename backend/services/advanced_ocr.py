from docling.document_converter import DocumentConverter

converter = DocumentConverter()

def extract_structured_text(pdf_path: str):
    """
    Convierte PDF a estructura tipo DOCX-friendly
    (MUCHO mejor que OCR + PaddleOCR manual)
    """

    result = converter.convert(pdf_path)
    doc = result.document

    pages = []

    for page in doc.pages:
        blocks = []

        for block in page.texts:
            blocks.append({
                "text": block.text,
                "boxes": getattr(block, "bbox", None)
            })

        pages.append(blocks)

    return pages