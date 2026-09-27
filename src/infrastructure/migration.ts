import type { MigrationInterface, QueryRunner } from 'typeorm';

export function nomeTabela(schema: string | undefined, nome: string): string {
  const escolhido = schema ?? 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(escolhido) || !/^[a-z_]+$/.test(nome)) throw new Error('Identificador SQL inválido');
  return `"${escolhido}"."${nome}"`;
}

export class EstruturaInicial1790000000000 implements MigrationInterface {
  name = 'EstruturaInicial1790000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tabela = (nome: string) => nomeTabela((queryRunner.connection.options as { schema?: string }).schema, nome);
    await queryRunner.query(`CREATE TABLE ${tabela('profissionais')} (
      id text PRIMARY KEY, nome text NOT NULL, email text NOT NULL, papeis jsonb NOT NULL,
      "precoCentavos" bigint NOT NULL CHECK ("precoCentavos" BETWEEN 0 AND 9007199254740991), disponibilidade jsonb NOT NULL,
      localizacao text NOT NULL, historico jsonb NOT NULL)`);
    await queryRunner.query(`CREATE TABLE ${tabela('competencias')} (
      id text PRIMARY KEY, "profissionalId" text NOT NULL REFERENCES ${tabela('profissionais')}(id) ON DELETE CASCADE,
      nome text NOT NULL, nivel double precision NOT NULL CHECK (nivel >= 0 AND nivel <= 5), UNIQUE ("profissionalId", nome))`);
    await queryRunner.query(`CREATE TABLE ${tabela('avaliacoes')} (
      id text PRIMARY KEY, "profissionalId" text NOT NULL REFERENCES ${tabela('profissionais')}(id) ON DELETE CASCADE,
      nota double precision NOT NULL CHECK (nota >= 0 AND nota <= 5), comentario text NOT NULL, data text NOT NULL)`);
    await queryRunner.query(`CREATE INDEX avaliacoes_profissional ON ${tabela('avaliacoes')} ("profissionalId")`);
    await queryRunner.query(`CREATE TABLE ${tabela('projetos')} (
      id text PRIMARY KEY, titulo text NOT NULL, genero text NOT NULL, "duracaoMinutos" double precision NOT NULL CHECK ("duracaoMinutos" > 0),
      "orcamentoCentavos" bigint NOT NULL CHECK ("orcamentoCentavos" BETWEEN 0 AND 9007199254740991), inicio text NOT NULL, prazo text NOT NULL,
      "tipoCaptacao" text NOT NULL, localizacao text NOT NULL, papeis jsonb NOT NULL,
      estrategia text NOT NULL CHECK (estrategia IN ('cosseno', 'colaborativa', 'orcamento')), parametros jsonb NOT NULL,
      "recomendacaoAtualId" text NOT NULL, excluidos jsonb NOT NULL, versao integer NOT NULL CHECK (versao > 0))`);
    await queryRunner.query(`CREATE TABLE ${tabela('equipes')} (
      id text PRIMARY KEY, "projetoId" text NOT NULL UNIQUE REFERENCES ${tabela('projetos')}(id) ON DELETE CASCADE,
      "papeisPendentes" jsonb NOT NULL, "custoCentavos" bigint NOT NULL CHECK ("custoCentavos" BETWEEN 0 AND 9007199254740991),
      status text NOT NULL CHECK (status IN ('PARCIAL', 'SUGERIDA', 'AGUARDANDO', 'CONFIRMADA')))`);
    await queryRunner.query(`CREATE TABLE ${tabela('membros_equipe')} (
      id text PRIMARY KEY, "equipeId" text NOT NULL REFERENCES ${tabela('equipes')}(id) ON DELETE CASCADE,
      papel text NOT NULL, "profissionalId" text NOT NULL REFERENCES ${tabela('profissionais')}(id),
      "precoCentavos" bigint NOT NULL CHECK ("precoCentavos" BETWEEN 0 AND 9007199254740991), pontuacao double precision NOT NULL,
      "aceitoProdutor" boolean NOT NULL, confirmado boolean NOT NULL, UNIQUE ("equipeId", papel), UNIQUE ("equipeId", "profissionalId"))`);
    await queryRunner.query(`CREATE TABLE ${tabela('recomendacoes')} (
      id text PRIMARY KEY, "projetoId" text NOT NULL REFERENCES ${tabela('projetos')}(id) ON DELETE CASCADE,
      estrategia text NOT NULL, candidatos jsonb NOT NULL, degradada boolean NOT NULL, avisos jsonb NOT NULL, "criadaEm" text NOT NULL)`);
    await queryRunner.query(`CREATE INDEX recomendacoes_projeto ON ${tabela('recomendacoes')} ("projetoId")`);
    await queryRunner.query(`ALTER TABLE ${tabela('projetos')} ADD CONSTRAINT recomendacao_atual_fk
      FOREIGN KEY ("recomendacaoAtualId") REFERENCES ${tabela('recomendacoes')}(id) DEFERRABLE INITIALLY DEFERRED`);
    await queryRunner.query(`CREATE TABLE ${tabela('convites')} (
      id text PRIMARY KEY, "projetoId" text NOT NULL REFERENCES ${tabela('projetos')}(id) ON DELETE CASCADE,
      papel text NOT NULL, "profissionalId" text NOT NULL REFERENCES ${tabela('profissionais')}(id),
      status text NOT NULL CHECK (status IN ('PENDENTE', 'ACEITO', 'RECUSADO', 'CANCELADO')), "criadoEm" text NOT NULL)`);
    await queryRunner.query(`CREATE INDEX convites_projeto ON ${tabela('convites')} ("projetoId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX convite_ativo_por_papel ON ${tabela('convites')} ("projetoId", papel) WHERE status IN ('PENDENTE', 'ACEITO')`);
    await queryRunner.query(`CREATE TABLE ${tabela('outbox_eventos')} (
      id text PRIMARY KEY, tipo text NOT NULL, "projetoId" text NOT NULL REFERENCES ${tabela('projetos')}(id) ON DELETE CASCADE,
      "ocorridoEm" text NOT NULL, dados jsonb NOT NULL, status text NOT NULL CHECK (status IN ('PENDENTE', 'ENTREGUE', 'FALHO')),
      tentativas integer NOT NULL, "disponivelEm" timestamptz NOT NULL, "ultimoErro" text)`);
    await queryRunner.query(`CREATE INDEX eventos_pendentes ON ${tabela('outbox_eventos')} ("disponivelEm") WHERE status = 'PENDENTE'`);
    await queryRunner.query(`CREATE INDEX eventos_projeto ON ${tabela('outbox_eventos')} ("projetoId")`);
    await queryRunner.query(`CREATE TABLE ${tabela('notificacoes')} (
      id text PRIMARY KEY, "eventoId" text NOT NULL REFERENCES ${tabela('outbox_eventos')}(id),
      canal text NOT NULL CHECK (canal IN ('email', 'interno')), destinatario text NOT NULL,
      assunto text NOT NULL, dados jsonb NOT NULL, "criadaEm" text NOT NULL)`);
    await queryRunner.query(`CREATE INDEX notificacoes_evento ON ${tabela('notificacoes')} ("eventoId")`);
    await queryRunner.query(`CREATE TABLE ${tabela('auditoria')} (
      id text PRIMARY KEY, "eventoId" text NOT NULL REFERENCES ${tabela('outbox_eventos')}(id), evento jsonb NOT NULL, "criadaEm" text NOT NULL)`);
    await queryRunner.query(`CREATE INDEX auditoria_evento ON ${tabela('auditoria')} ("eventoId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tabela = (nome: string) => nomeTabela((queryRunner.connection.options as { schema?: string }).schema, nome);
    await queryRunner.query(`ALTER TABLE ${tabela('projetos')} DROP CONSTRAINT recomendacao_atual_fk`);
    for (const nome of ['auditoria', 'notificacoes', 'outbox_eventos', 'convites', 'recomendacoes', 'membros_equipe', 'equipes', 'projetos', 'avaliacoes', 'competencias', 'profissionais']) {
      await queryRunner.query(`DROP TABLE ${tabela(nome)}`);
    }
  }
}
