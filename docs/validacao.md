# Validação da entrega

Execução em 24/09/2026, Windows 11, Node 24.14.0, PostgreSQL 18.6, Ryzen 5 3600, 12 processadores lógicos e 16 GB de RAM.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | Sem erros com TypeScript estrito |
| `npm run test:coverage` | 77 testes aprovados; nenhum ignorado |
| Linhas e instruções | 97,09% |
| Ramificações | 98,37% |
| Funções | 96,00% |
| `npm run db:migrate` | Migração aplicada no PostgreSQL real |
| `npm run db:seed` | 18 profissionais fictícios persistidos |
| `npm run demo` | Fluxo HTTP completo, incluindo recusa, nova sugestão e confirmação |
| `npm run evaluate` | Métrica sintética calculada para as três estratégias |
| `npm run test:load` | 300 solicitações HTTP válidas, em três rodadas de 100 simultâneas |

O escopo de cobertura contém **todos** os arquivos `src/**/*.ts`, sem exclusões adicionais. `server.ts` não é importado pelos testes unitários, aparecendo com 0%; a inicialização real foi verificada pela demonstração. A migração também entra no denominador. Dados brutos: [testes.txt](testes.txt) e [cobertura.json](cobertura.json). O HTML produzido está em `../coverage/index.html`.

## Carga

Cadastro com 10 mil profissionais no PostgreSQL real. Cada rodada envia 100 requisições de criação de projeto simultâneas por HTTP TCP. O cliente roda em outro processo Node; o processador de eventos permanece ativo. A leitura do cadastro e o cálculo começam frios a cada rodada. Os títulos variam, mas os critérios são iguais dentro de cada rodada; portanto, o cache de critérios é utilizado. O logger HTTP foi desabilitado nesta medição.

| Estratégia | p50 | p95 | Máximo | Erros |
|---|---:|---:|---:|---:|
| Cosseno | 764 ms | 868 ms | 883 ms | 0 |
| Colaborativa | 913 ms | 993 ms | 994 ms | 0 |
| Orçamento | 461 ms | 534 ms | 535 ms | 0 |

O cliente verifica resposta 201, seis membros diferentes, custo dentro do orçamento e ausência de degradação. O tempo inclui receber e interpretar a resposta completa. O script falha se houver resposta inválida ou se o máximo atingir dois segundos. Registro da execução: [carga.json](carga.json).

Esse resultado comprova o cenário descrito. Não demonstra o mesmo limite para qualquer distribuição de 100 projetos com critérios diferentes, outros históricos ou máquinas menos potentes. A pontuação colaborativa e os cálculos inéditos usam CPU da aplicação; diversificar os critérios reduz o benefício do cache.

## Casos relevantes cobertos

- Estratégias com resultados diferentes e início sem histórico colaborativo.
- Restrição de período, cidade, papel e orçamento; competências ausentes e pontuação finita.
- Comparação da viabilidade da alocação com busca exaustiva em pequenos catálogos.
- Sequência do Template Method e bloqueio de sobrescrita do método principal.
- Visitors sobre projeto e profissional, incluindo a composição real da equipe.
- Recusa, substituição automática/manual, reavaliação e cancelamento de convites antigos.
- Preservação dos demais papéis e de seus aceites durante uma substituição.
- Aceites concorrentes, respostas repetidas e um único evento de confirmação.
- Transações, chaves estrangeiras, rollback e bloqueio de projeto em PostgreSQL real.
- Eventos não publicados antes do commit, retries, eventos falhos e workers concorrentes.
- Observadores independentes, throws, rejeições tardias, timeout e encerramento.
- Notificações e auditoria idempotentes mesmo quando há repetição de entrega.
- Cadastro indisponível, cache expirado, consulta travada e recuperação.
- Recusa persistida com cadastro indisponível, mantendo os outros membros e sinalizando equipe parcial.
- Erros HTTP, datas inválidas, campos desconhecidos e valores monetários maiores que um inteiro de 32 bits.

## Qualidade e limites

O exemplo de `precision@3` produz 1,00 para cosseno, 0,67 para colaborativa e 0,00 para orçamento na fixture rotulada. Isso apenas demonstra a medição e diferenças entre objetivos; não é uma estimativa de qualidade em produção. Os rótulos desse exemplo privilegiam a adequação técnica, e não o menor custo. Veja [avaliacao.json](avaliacao.json) e [algoritmos.md](algoritmos.md).

O envio de e-mail é uma caixa de saída local; nenhum e-mail externo foi enviado. Não foram executados testes em Ubuntu, nem autenticação, agenda global de reservas ou integração com serviços financeiros externos. Esses limites estão descritos no README para não confundir a execução acadêmica com uma implantação pública.
