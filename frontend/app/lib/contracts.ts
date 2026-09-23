export const contracts = [
  {
    id: 1,
    code: 'LP-001',
    title: 'Servicio Integral de Limpieza',
    entity: 'Municipalidad Provincial',
    contractor: 'Grupo Ecolimp',
    location: 'Lima',
    amount: 350000,
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-12-31',

    documents: [
      {
        id: 'doc1',
        label: 'Bases Integradas',
        document_id: null
      },
      {
        id: 'doc2',
        label: 'Contrato Firmado',
        document_id: null
      },
      {
        id: 'doc3',
        label: 'Términos de Referencia',
        document_id: null
      }
    ]
  },

  {
    id: 2,
    code: 'LP-002',
    title: 'Servicio de Vigilancia',
    entity: 'Gobierno Regional',
    contractor: 'Grupo Ecolimp',
    location: 'Arequipa',
    amount: 800000,
    status: 'active',
    start_date: '2026-02-01',
    end_date: '2027-01-31',

    documents: [
      {
        id: 'doc4',
        label: 'Bases',
        document_id: null
      },
      {
        id: 'doc5',
        label: 'Anexos',
        document_id: null
      }
    ]
  }
]