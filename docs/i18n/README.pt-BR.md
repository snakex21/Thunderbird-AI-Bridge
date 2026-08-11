# Thunderbird AI Bridge

[English / lista completa de idiomas](../../README.md)

## O que é?

Thunderbird AI Bridge é uma ponte local entre o Thunderbird e agentes de IA, ferramentas de linha de comando, scripts e aplicativos personalizados. A extensão executa operações na caixa de correio e um programa local se comunica com ela por um pequeno protocolo HTTP em `127.0.0.1`.

**SuperCLI não é obrigatório.** O primeiro host foi criado para o SuperCLI, mas qualquer programa pode usar a extensão se implementar o protocolo descrito em [docs/PROTOCOL.md](../PROTOCOL.md).

## Recursos

- listar contas e pastas,
- criar, renomear e excluir pastas,
- pesquisar por remetente, destinatário/endereço, assunto, texto e data,
- ler mensagens sem alterar intencionalmente o estado de lida/não lida,
- paginar mensagens longas,
- listar e transferir anexos para modelos com visão ou processadores de documentos,
- mover mensagens, enviar para a Lixeira e restaurar,
- exclusão permanente com verificação IMAP,
- Empty Trash/EXPUNGE nativo do Thunderbird,
- importar mensagens Outlook `.msg` convertidas para `.eml`,
- operações em massa em lotes limitados com tokens de continuação.

## Segurança

Operações sensíveis possuem proteções adicionais. Ações destrutivas exigem `confirm: true`, a exclusão permanente fica restrita à Lixeira e pastas de sistema/root são protegidas. O host também deve pedir uma confirmação clara ao usuário.

A ponte foi projetada para uso local. Não exponha o host diretamente à LAN ou à Internet.

## Build

Requer Thunderbird 128 ou mais recente.

```bash
python scripts/build_xpi.py
npm test
```

O XPI é gerado em `dist/thunderbird-ai-bridge.xpi` e pode ser instalado manualmente pelo gerenciador de extensões do Thunderbird.

Status: experimental (`0.9.21`). O protocolo pode mudar antes da versão `1.0`.

Licença MIT. Projeto independente, sem afiliação ou endosso da Mozilla ou Thunderbird.
