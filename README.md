# Cinebridge

API para recomendar profissionais e montar equipes de projetos audiovisuais. Desenvolvida para a atividade ATVI, com os padrões Strategy, Template Method, Observer e Visitor.

## Tecnologias

Node.js 24, TypeScript, Fastify, TypeORM, PostgreSQL e EventEmitter. Testes com `node:test`.

## Executar

1. Instale as dependências com `npm ci`.
2. Copie `.env.example` para `.env` e configure a conexão com o banco.
3. Inicie o PostgreSQL. Se usar Docker, execute `docker compose up -d --wait`.
4. Execute:

```sh
npm run db:migrate
npm run db:seed
npm start
```

A API fica em `http://localhost:3000`. Para demonstrar o fluxo, execute `npm run demo` em outro terminal.

## Testes

```sh
npm test
npm run test:integration
npm run test:coverage
```

Os testes de integração e cobertura precisam de PostgreSQL e da variável `TEST_DATABASE_URL` configurada no `.env`.

As rotas estão descritas em [docs/api.md](docs/api.md). O projeto não possui interface gráfica; as notificações de e-mail são registradas localmente, sem envio SMTP.
