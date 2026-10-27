# Contrato de componentes da IA deriva de uma única fonte

Os Tipos de componente existiam em dois lugares (o enum do contrato do dashboard e o schema de propostas da IA) e divergiram: `line_chart` era renderizável, mas a IA era obrigada a rejeitá-lo e trocava o gráfico em silêncio. Decidimos que o schema de propostas da IA seja derivado da mesma fonte dos Tipos de componente, para que adicionar um tipo em um lugar o habilite em todos.
