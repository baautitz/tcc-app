/**
 * Contexto de negócio das tabelas da fonte Olist (dicionário de dados).
 * Descreve o significado das colunas a partir da documentação pública do conjunto
 * (Kaggle, Olist Brazilian E-Commerce); não contém regras de nenhuma pergunta específica.
 */
export const olistTableContexts: Record<string, string> = {
  categories:
    "Categorias de produto. category_name é o nome em português (é a chave usada em products.category_name); category_name_english é a tradução em inglês.",
  cities:
    "Cidades brasileiras. city_id é a chave; name é o nome da cidade e state_code, a sigla da UF (ligada a states).",
  customers:
    "Clientes únicos. customer_unique_id identifica a pessoa; a mesma pessoa pode ter vários customer_id, um por pedido (ver order_customers).",
  geolocations:
    "Coordenadas (latitude e longitude) de prefixos de CEP, ligadas a cidades. Um prefixo pode ter várias coordenadas.",
  order_customers:
    "Cliente de cada pedido. customer_id é a chave usada em orders.customer_id e liga o pedido ao cliente único (customer_unique_id), ao prefixo de CEP e à cidade de entrega (city_id).",
  order_items:
    "Itens de cada pedido, uma linha por item (order_item_id começa em 1). price é o preço do item em reais, sem frete; freight_value é o frete do item em reais (o frete do pedido é dividido entre os itens); shipping_limit_at é o prazo para o vendedor entregar à transportadora.",
  order_payments:
    "Pagamentos de cada pedido. Um pedido pode ter vários pagamentos (payment_sequential); payment_type é a forma de pagamento; payment_installments, o número de parcelas; payment_value, o valor pago em reais, que inclui o frete.",
  order_reviews:
    "Relação N:N entre pedidos (orders) e avaliações (reviews).",
  order_statuses:
    "Status possíveis de um pedido: created, approved, invoiced, processing, shipped, delivered, canceled e unavailable.",
  orders:
    "Pedidos. purchased_at é a data e hora da compra; approved_at, a da aprovação do pagamento; delivered_to_carrier_at, a da entrega à transportadora; delivered_to_customer_at, a da entrega ao cliente; estimated_delivery_at, a data estimada de entrega informada ao cliente. order_status é o status atual e customer_id liga a order_customers.",
  payment_methods:
    "Formas de pagamento: credit_card, boleto, voucher, debit_card e not_defined.",
  products:
    "Produtos. category_name liga a categories; os demais campos descrevem o anúncio (tamanho do nome e da descrição, número de fotos) e as dimensões e o peso do produto.",
  reviews:
    "Avaliações dos clientes. review_score vai de 1 a 5; o título e a mensagem do comentário são opcionais; created_at é quando a pesquisa de satisfação foi enviada e answered_at, quando foi respondida. Liga aos pedidos por order_reviews.",
  sellers:
    "Vendedores. Liga ao prefixo de CEP e à cidade do vendedor (city_id).",
  states: "Siglas das unidades federativas (UF).",
  zip_code_prefixes: "Prefixos de CEP (cinco primeiros dígitos).",
};
