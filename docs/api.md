# Uso da API

Todos os corpos são JSON. Envie `Content-Type: application/json`. IDs retornados pela API são UUIDs. As datas são `AAAA-MM-DD`, sem horário; o período inclui início e fim.

## Criar projeto

`POST /projetos` com o conteúdo de `examples/projeto.json`. O retorno 201 tem:

```text
projeto       dados, critérios e parâmetros efetivos
equipe        membros, custoCentavos, papeisPendentes e status
recomendacao  ranking por papel, motivos, estratégia, avisos e flag degradada
convites      histórico dos convites (inicialmente vazio)
excluidos     IDs descartados por papel
versao        revisão transacional do projeto
```

`estrategia`: `cosseno`, `colaborativa` ou `orcamento`. Os parâmetros opcionais são `pesoCompetencia`, `pesoAvaliacao`, `pesoPreco` (0 a 1, soma positiva) e `limiteCandidatos` (1 a 100). Pesos padrão: 0,65 / 0,25 / 0,10; limite: 10. Os pesos são normalizados pela soma no cálculo.

Cada papel recebe `papel`, `peso` positivo e `competencias: [{nome, nivel}]`. A importância do papel orienta a alocação da equipe. O projeto pode exigir de um a seis papéis, sem repetir: `DIRETOR`, `DIRETOR_FOTOGRAFIA`, `SONOPLASTA`, `EDITOR`, `ROTEIRISTA`, `EFEITOS_VISUAIS`.

## Aceitar sugestões

`POST /projetos/:id/aceitar`

```json
{}
```

Aceita todos os membros sugeridos. Para selecionar papéis específicos:

```json
{"papeis":["DIRETOR","EDITOR"]}
```

Cada novo aceite cria um convite `PENDENTE`. Repetir o aceite não duplica convites. O produtor não confirma em nome do profissional.

## Rejeitar ou substituir

`POST /projetos/:id/membros/EDITOR/substituir`

```json
{}
```

Exclui o atual do papel e busca outra opção. Os outros membros permanecem fixos. Para indicar uma pessoa do cadastro:

```json
{"profissionalId":"UUID_DO_PROFISSIONAL"}
```

O novo profissional precisa atender às restrições e ao orçamento restante. A escolha inválida retorna 422 e reverte a operação inteira. Quem recusou ou foi rejeitado não volta automaticamente ao mesmo papel nesse projeto.

## Responder convite

`POST /projetos/:id/convites/:conviteId/resposta`

```json
{"profissionalId":"UUID_DO_DESTINATARIO","resposta":"ACEITO"}
```

Use `RECUSADO` para recusar. A recusa dispara recomendação somente para o papel afetado. A nova sugestão não é convidada sem aceite do produtor. A última confirmação necessária muda a equipe para `CONFIRMADA` e registra `equipe.confirmada`.

## Reavaliar

`POST /projetos/:id/reavaliar`

```json
{"orcamentoCentavos":300000,"prazo":"2027-03-25","estrategia":"orcamento"}
```

Permite alterar orçamento, início, prazo, estratégia e parâmetros. `{}` também solicita uma nova avaliação com os mesmos critérios. Cancela os convites ativos e exige novo consenso sobre a equipe sugerida.

## Estados e leitura

- `PARCIAL`: existe papel sem profissional elegível dentro do orçamento.
- `SUGERIDA`: equipe completa, ainda sem convites aceitos pelo produtor.
- `AGUARDANDO`: pelo menos um convite emitido, faltando consenso.
- `CONFIRMADA`: todos os papéis preenchidos, com aceite do produtor e de cada profissional.

Uma equipe parcial também pode conter convites ativos para os papéis já preenchidos. `papeisPendentes` trata falta de profissional; `confirmado` trata a resposta do convite. Não são a mesma coisa.

`GET /projetos/:id/relatorio` retorna texto, inconsistências, compatibilidade de 0 a 1 e informações de contingência. A compatibilidade avalia a composição real, sem trocar integrantes por opções melhores do ranking.

`GET /projetos/:id/notificacoes` e `/auditoria` têm consistência eventual: a resposta de uma alteração pode chegar antes do processamento dos observadores. Normalmente a próxima rodada do worker começa em até 200 ms. A outbox sobrevive ao reinício do processo.

## Respostas de erro

| Código | Significado |
|---|---|
| 400 | Formato, campo, enumeração ou tipo inválido |
| 403 | `profissionalId` diferente do destinatário do convite; não substitui autenticação |
| 404 | Projeto ou convite inexistente |
| 409 | Convite cancelado/respondido em sentido contrário, ou conflito de unicidade |
| 413 | Corpo maior que 256 KiB |
| 422 | Regra de domínio ou integridade violada |
| 503 | Persistência indisponível, ou cadastro indisponível para confirmar uma escolha |
| 500 | Falha inesperada registrada no log, sem expor detalhes internos |

Um orçamento insuficiente não é, por si só, erro 422: retorna equipe parcial com explicação. Se o próprio banco da aplicação estiver indisponível, a API não promete persistir uma nova recomendação; a contingência do cadastro não substitui a persistência transacional.
