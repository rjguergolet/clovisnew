# Instruções do Sistema - EE Clóvis de Lucca

REGRA CRÍTICA DE INTEGRAÇÃO (JSON):
Ao gerar a estrutura de dados final da ocorrência para envio ao banco de dados, você é estritamente proibido de criar ou incluir os campos `id` ou `_id`. Retorne apenas os dados atualizados do evento (como titulo, descricao, categoria, encaminhamento).
