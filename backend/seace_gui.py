"""
seace_gui.py
Ventana de escritorio para buscar un proceso SEACE por nomenclatura y ver
el estado + cuadro comparativo + documentos de cada postor.

Uso:
    python seace_gui.py

Requisitos: que test_scraping_seace.py esté en la MISMA carpeta que este
archivo (usa sus funciones directamente).
"""

import threading
import tkinter as tk
from tkinter import ttk, messagebox

from test_scraping_seace import ejecutar_busqueda


class SeaceApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Buscador SEACE - Cuadro Comparativo")
        self.geometry("900x650")
        self.minsize(700, 500)

        self._construir_widgets()

    def _construir_widgets(self):
        # --- Barra superior: nomenclatura + botón buscar ---
        barra = ttk.Frame(self, padding=10)
        barra.pack(fill="x")

        ttk.Label(barra, text="Nomenclatura:").pack(side="left")

        self.entry_nomenclatura = ttk.Entry(barra, width=40)
        self.entry_nomenclatura.pack(side="left", padx=8)
        self.entry_nomenclatura.insert(0, "LP-ABR-1-2026-GRC-C-1")
        self.entry_nomenclatura.bind("<Return>", lambda e: self._on_buscar())

        self.boton_buscar = ttk.Button(barra, text="Buscar", command=self._on_buscar)
        self.boton_buscar.pack(side="left", padx=4)

        self.check_headless_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            barra, text="Sin ventana de navegador (más rápido)",
            variable=self.check_headless_var
        ).pack(side="left", padx=12)

        self.label_estado = ttk.Label(barra, text="", foreground="#555555")
        self.label_estado.pack(side="left", padx=12)

        # --- Cuerpo: árbol de resultados ---
        cuerpo = ttk.Frame(self, padding=(10, 0, 10, 10))
        cuerpo.pack(fill="both", expand=True)

        self.info_proceso = tk.StringVar(value="")
        ttk.Label(cuerpo, textvariable=self.info_proceso, wraplength=860,
                  justify="left", font=("Segoe UI", 9, "bold")).pack(fill="x", pady=(0, 8))

        self.arbol = ttk.Treeview(cuerpo, columns=("valor",), show="tree headings", height=20)
        self.arbol.heading("#0", text="Postor / Ítem / Documento")
        self.arbol.heading("valor", text="Detalle")
        self.arbol.column("#0", width=420)
        self.arbol.column("valor", width=400)
        self.arbol.pack(fill="both", expand=True, side="left")

        scrollbar = ttk.Scrollbar(cuerpo, orient="vertical", command=self.arbol.yview)
        scrollbar.pack(fill="y", side="right")
        self.arbol.configure(yscrollcommand=scrollbar.set)

    def _on_buscar(self):
        nomenclatura = self.entry_nomenclatura.get().strip()
        if not nomenclatura:
            messagebox.showwarning("Falta la nomenclatura", "Escribe una nomenclatura primero.")
            return

        self.boton_buscar.config(state="disabled")
        self.label_estado.config(text="Buscando... esto puede tardar 1-2 minutos.")
        for item in self.arbol.get_children():
            self.arbol.delete(item)
        self.info_proceso.set("")

        headless = self.check_headless_var.get()

        hilo = threading.Thread(
            target=self._buscar_en_hilo, args=(nomenclatura, headless), daemon=True
        )
        hilo.start()

    def _buscar_en_hilo(self, nomenclatura, headless):
        try:
            resultado = ejecutar_busqueda(nomenclatura, headless=headless)
        except Exception as e:
            resultado = {"error": f"Error inesperado: {e}"}
        # Volvemos al hilo principal de Tkinter para actualizar la UI
        self.after(0, self._mostrar_resultado, resultado)

    def _mostrar_resultado(self, resultado: dict):
        self.boton_buscar.config(state="normal")

        if resultado.get("error"):
            self.label_estado.config(text="Error.")
            messagebox.showerror("No se pudo completar la búsqueda", resultado["error"])
            return

        self.label_estado.config(text="Listo.")
        self.info_proceso.set(
            f"{resultado['nomenclatura']}  |  {resultado['entidad']}\n"
            f"{resultado['objeto']}: {resultado['descripcion']}\n"
            f"Monto referencial: {resultado['monto']} {resultado['moneda']}"
        )

        for postor in resultado["postores"]:
            nombre_postor = postor.get("razon_social") or "(sin nombre)"
            nodo_postor = self.arbol.insert(
                "", "end",
                text=f"{nombre_postor}  (RUC {postor.get('ruc')})",
                values=(f"Estado: {postor.get('estado_registro')} / {postor.get('estado_propuesta')}",)
            )

            nodo_items = self.arbol.insert(nodo_postor, "end", text="Ítems ofertados", values=("",))
            for it in postor.get("items", []):
                self.arbol.insert(
                    nodo_items, "end",
                    text=f"Ítem {it['nro']}",
                    values=(f"Monto ofertado: {it['monto_ofertado']} "
                            f"(cant. ofertada: {it['cantidad_ofertada']})",)
                )

            nodo_docs = self.arbol.insert(nodo_postor, "end", text="Documentos", values=("",))
            for d in postor.get("documentos", []):
                self.arbol.insert(
                    nodo_docs, "end",
                    text=d["nombre_archivo"],
                    values=(f"{d['tipo_archivo']} - {d['tamano_archivo']}",)
                )

            self.arbol.item(nodo_postor, open=True)
            self.arbol.item(nodo_items, open=True)
            self.arbol.item(nodo_docs, open=True)


if __name__ == "__main__":
    app = SeaceApp()
    app.mainloop()