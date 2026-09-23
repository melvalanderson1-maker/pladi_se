from pdf2docx import Converter
cv = Converter(r"C:\Users\MSICROSS\Documents\SEACE_PLADIBOT\archivos\73819\cotizacion\288928_ANEXOS BIENES.pdf")
cv.convert(r"C:\Users\MSICROSS\Documents\SEACE_PLADIBOT\archivos\73819\cotizacion\test_output.docx")
cv.close()