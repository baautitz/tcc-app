# TCC App

Plataforma em que administradores conectam fontes de dados externas, salvam queries e montam dashboards, com apoio de um agente de IA cujas sugestões só valem depois de aprovação humana.

## Language

### Acesso

**Admin**:
Usuário com poder de gerir tudo na plataforma.
_Avoid_: Administrador de sistema, superusuário

**Permissão**:
Direito específico concedido a um usuário não-admin. O catálogo de permissões é fixo e somente leitura.
_Avoid_: Papel, role

**Ator**:
Usuário autenticado que executa uma ação numa Sessão. Um Recibo só vale para o Ator que o gerou.
_Avoid_: Operador

**Sessão**:
Período de autenticação de um usuário na plataforma.
_Avoid_: Login

### Conteúdo

**Fonte de dados**:
Conexão com um PostgreSQL externo que a plataforma consulta.
_Avoid_: Banco, database, datasource

**Catálogo**:
Lista de tabelas e colunas descoberta por inspeção de uma Fonte de dados. O Contexto descreve o Catálogo.
_Avoid_: Schema, metadados

**Query**:
SQL salvo sobre uma Fonte de dados, com identificador `queryUuid` e parâmetros. Uma Query pode ser reutilizada por vários Dashboards e só entra em uso depois de testada (Recibo de teste).
_Avoid_: Consulta, relatório

**Dashboard**:
Painel descrito por um arquivo JSON, versionado por revisão. A tabela `dashboards` é só o índice (identificador e caminho do arquivo); o conteúdo vive no arquivo.
_Avoid_: Painel, relatório

**Componente**:
Elemento visual de um Dashboard, alimentado por uma Query e de um Tipo de componente.
_Avoid_: Widget, gráfico (quando se fala de qualquer tipo)

**Tipo de componente**:
Forma de exibir os dados de um Componente. Existem cinco: cartão de indicador, gráfico de barras, gráfico de linhas, gráfico de pizza e tabela. O Tipo pedido pelo administrador é respeitado literalmente; se não servir aos dados, a IA pergunta antes de trocar.
_Avoid_: Formato, visual

**Dashboard ativo**:
Dashboard sobre o qual a conversa com a IA está trabalhando, vindo da página aberta ou escolhido pelo administrador. É exigido para gerar um Componente e é a fonte dos filtros mostrados no cartão do Componente isolado.
_Avoid_: Dashboard atual, dashboard selecionado

**Contexto**:
Descrição semântica de uma tabela ou coluna de uma fonte de dados, lida pela IA para escrever queries. Só muda depois que um humano aprova uma Proposta de contexto.
_Avoid_: Metadados, documentação da tabela

### Aprovação

**Execução limitada**:
Execução de SQL feita pela IA numa Fonte de dados, somente leitura e com limites de tempo, de linhas e de bytes. Quando o resultado é cortado, um humano precisa reconhecer o corte antes de aplicar a Proposta de dashboard.
_Avoid_: Guardrails, execução segura

**Proposta de dashboard**:
Criação ou alteração de um Dashboard sugerida pela IA, com preview e commit, protegida por um Recibo de proposta.
_Avoid_: Proposta (sozinho), rascunho

**Proposta de contexto**:
Alteração de Contexto sugerida pela IA, que só entra na fonte de dados após aprovação humana.
_Avoid_: Proposta (sozinho)

**Recibo**:
Token de uso único, com prazo, que prova que uma ação foi pré-validada. Existem três tipos: Recibo de teste, Recibo de componente e Recibo de proposta.
_Avoid_: Ticket, comprovante

**Recibo de teste**:
Recibo que prova que uma query salva foi testada; vale por 10 minutos.

**Recibo de componente**:
Recibo que prova que o administrador aprovou um Componente isolado, antes de definir o dashboard de destino e a posição. Não persiste nada; só libera a Proposta de dashboard.

**Recibo de proposta**:
Recibo que prova que uma Proposta de dashboard foi validada para o commit; liga a proposta ao ator, aos documentos e à expiração.
