# Recomendações e formação da equipe

O domínio é TypeScript executado diretamente no Node 24, sem compilação na execução. Datas são dias de calendário (`AAAA-MM-DD`), preços são inteiros em centavos e níveis/notas ficam entre 0 e 5. O preço representa a contratação para o período inteiro; não é uma diária. Uma pessoa ocupa no máximo um papel no mesmo projeto.

## Ordem do processamento

`OrquestradorEquipe` implementa o Template Method: validar projeto → normalizar cadastros → validar escolhas fixas → aplicar Strategy → excluir recusados → montar equipe e apresentar ranking. O método `orquestrar` é concreto. Como TypeScript não oferece `final`, o construtor instala uma propriedade não gravável e não configurável. As subclasses implementam apenas as etapas protegidas. Um teste verifica a ordem e a proteção.

Cada execução cria sua própria estratégia; não existe estratégia global mutável. Isso evita que duas requisições simultâneas troquem o algoritmo uma da outra.

O profissional precisa ter o papel cadastrado, atender ao período inteiro e à cidade solicitada. A localização `remoto` habilita trabalho a distância. Cadastros inválidos ou duplicados são descartados com aviso. As escolhas fixas são verificadas e preservadas, inclusive preço acordado e confirmações.

## Três estratégias

**Cosseno:** considera apenas as dimensões pedidas para o papel. Calcula o cosseno entre competências e multiplica pela cobertura dos níveis pedidos. Isso evita que, em uma competência, um nível 1 receba a mesma compatibilidade de um nível 5. Combina esse resultado, avaliação média e economia pelos três pesos parametrizados do projeto. Sem avaliações, utiliza a nota neutra 2,5/5.

**Colaborativa:** usa uma matriz esparsa profissional–produção. `historico[].projetoId` identifica produções compartilhadas e `nota` guarda a avaliação naquele trabalho. A similaridade de dois profissionais é `1 - diferença média absoluta das notas normalizadas`, com redução de confiança `n/(n+2)` quando há poucas produções em comum. A previsão usa notas dos dez vizinhos mais próximos em trabalhos do mesmo gênero, tipo de captação e papel. Profissionais fora da localização também podem informar o modelo, sem serem candidatos à equipe. Há uma amostra determinística de até 64 vizinhos para limitar custo; ordenar por ID evita que a ordem do banco altere a amostra. Sem interseção válida, utiliza previsão neutra e informa essa limitação no motivo do candidato.

Na colaborativa, o componente principal contém 80% previsão colaborativa e 20% compatibilidade técnica. O componente de avaliação contém 75% previsão e 25% afinidade com o contexto. Os pesos do projeto combinam esses componentes e a economia. É um modelo simples de vizinhança com contexto; o pequeno histórico de exemplo não representa desempenho real.

**Orçamento:** atribui 70% da pontuação à economia relativa ao teto do projeto e 30% à qualidade ponderada pelos parâmetros. O orçamento total é uma restrição obrigatória também nas outras duas estratégias.

Todos os rankings incluem a pontuação e os motivos. Empates usam preço e ID para manter resultado reproduzível.

## Atribuição dos papéis

Ordenar cada papel e escolher o primeiro pode falhar: uma pessoa versátil pode ser a única disponível para outro papel. Também é incorreto limitar a busca aos dez nomes exibidos e concluir que não existe equipe barata.

A implementação resolve uma atribuição de custo mínimo por programação dinâmica sobre até seis papéis. Cada profissional entra apenas uma vez, evitando duplicação. Para um objetivo aditivo, bastam os seis melhores candidatos de cada papel: no máximo cinco deles podem estar ocupados em outros papéis; um candidato pior pode ser substituído por um desses seis sem piorar o objetivo. O limite usado é, na verdade, a quantidade de papéis ainda em aberto.

Assim, a viabilidade é exata: se existe uma equipe completa elegível dentro do orçamento, ela é encontrada. Caso contrário, o resultado parcial preenche o máximo possível de papéis e prioriza os maiores pesos. Um teste compara esse resultado com busca exaustiva em 35 catálogos pequenos gerados com semente fixa.

Depois, até oito objetivos com penalidades diferentes de custo procuram melhorar a pontuação. A **maior pontuação possível sob um teto de gastos não é garantida** por essa busca limitada. Essa escolha mantém o custo previsível. A viabilidade exata e as restrições não são relaxadas. O ranking só é reduzido ao limite de exibição depois da escolha da equipe; a equipe pode conter uma pessoa que não aparece nos primeiros resultados daquele papel.

## Visitors

`Projeto` e `Profissional` oferecem `aceitar(visitante)`, que faz o despacho para o tipo certo. `ValidadorConsistencia` valida dados e, quando recebe uma equipe, verifica preenchimento, exclusividade, custo e confirmações. `CalculadorCompatibilidade` calcula adequação técnica ponderada dos profissionais efetivamente atribuídos; papel pendente vale zero. Sem equipe, calcula uma estimativa potencial sobre o catálogo informado. `GeradorRelatorio` descreve o projeto e sua composição com valores, confirmações e pendências. Os visitantes não escrevem no banco.

## Qualidade da recomendação

Execute `npm run evaluate`. O script calcula `precision@3` para as três estratégias, usando uma lista explícita de profissionais relevantes de uma **fixture sintética**. Os rótulos não são derivados automaticamente da pontuação. O exemplo serve para conferir o cálculo e tornar diferenças observáveis; não permite afirmar que o sistema tem a mesma precisão no mundo real.

Para medir qualidade real, seriam necessários projetos históricos com escolhas avaliadas, divisão temporal entre dados do modelo e dados de teste, rótulos revisados e comparação com uma base simples. Esse conjunto não foi fornecido. Notas do trabalho avaliam a atuação do profissional, não preferências individuais de espectadores.
