import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import type { Mudanca, Repositorio } from '../application/ports.ts';
import { ErroDominio } from '../domain/types.ts';
import type { Auditoria, EstadoProjeto, Evento, Notificacao, ProfissionalDados } from '../domain/types.ts';
import { AuditoriaEntity, AvaliacaoEntity, CompetenciaEntity, ConviteEntity, ENTIDADES, EquipeEntity,
  EventoEntity, MembroEntity, NotificacaoEntity, ProfissionalEntity, ProjetoEntity, RecomendacaoEntity } from './entities.ts';
import type { EventoRegistro, ProjetoRegistro } from './entities.ts';
import { EstruturaInicial1790000000000, nomeTabela } from './migration.ts';

export function criarDataSource(url: string): DataSource {
  return new DataSource({ type: 'postgres', url, entities: ENTIDADES, migrations: [EstruturaInicial1790000000000],
    synchronize: false, migrationsRun: false, migrationsTableName: 'migracoes',
    extra: { max: 25, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 5_000, query_timeout: 6_000 },
  });
}

export class RepositorioPostgres implements Repositorio {
  private db: DataSource;
  constructor(db: DataSource) { this.db = db; }

  async listarProfissionais(): Promise<ProfissionalDados[]> {
    // Three bulk reads avoid both N+1 and multiplying competence × evaluation rows.
    return this.db.transaction('REPEATABLE READ', async manager => {
      const profissionais = await manager.find(ProfissionalEntity, { order: { id: 'ASC' } });
      const competencias = await manager.find(CompetenciaEntity, { order: { id: 'ASC' } });
      const avaliacoes = await manager.find(AvaliacaoEntity, { order: { id: 'ASC' } });
      const resultado = new Map<string, ProfissionalDados>(profissionais.map(p => [p.id, { ...p, competencias: [], avaliacoes: [] }]));
      for (const { profissionalId, nome, nivel } of competencias) resultado.get(profissionalId)?.competencias.push({ nome, nivel });
      for (const { profissionalId, nota, comentario, data } of avaliacoes) resultado.get(profissionalId)?.avaliacoes.push({ nota, comentario, data });
      return [...resultado.values()];
    });
  }

  async salvarProfissional(profissional: ProfissionalDados): Promise<void> {
    const { competencias, avaliacoes, ...registro } = profissional;
    await this.db.transaction(async manager => {
      await manager.upsert(ProfissionalEntity, registro, ['id']);
      await manager.delete(CompetenciaEntity, { profissionalId: profissional.id });
      await manager.delete(AvaliacaoEntity, { profissionalId: profissional.id });
      if (competencias.length) await manager.insert(CompetenciaEntity, competencias.map((item, i) => ({
        ...item, id: `${profissional.id}:competencia:${i.toString().padStart(5, '0')}`, profissionalId: profissional.id,
      })));
      if (avaliacoes.length) await manager.insert(AvaliacaoEntity, avaliacoes.map((item, i) => ({
        ...item, id: `${profissional.id}:avaliacao:${i.toString().padStart(5, '0')}`, profissionalId: profissional.id,
      })));
    });
  }

  async buscarEstado(id: string): Promise<EstadoProjeto | null> {
    return this.db.transaction('REPEATABLE READ', manager => this.lerEstado(manager, id));
  }

  private async lerEstado(manager: EntityManager, id: string, bloquear = false): Promise<EstadoProjeto | null> {
    const registro = await manager.findOne(ProjetoEntity, {
      where: { id }, ...(bloquear ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!registro) return null;
    const { recomendacaoAtualId, excluidos, versao, ...projeto } = registro;
    const equipe = await manager.findOneByOrFail(EquipeEntity, { projetoId: id });
    const recomendacao = await manager.findOneByOrFail(RecomendacaoEntity, { id: recomendacaoAtualId });
    const convites = await manager.find(ConviteEntity, { where: { projetoId: id }, order: { criadoEm: 'ASC', id: 'ASC' } });
    const membros = (await manager.find(MembroEntity, { where: { equipeId: equipe.id }, order: { id: 'ASC' } }))
      .map(({ id: _id, equipeId: _equipeId, ...membro }) => membro)
      .sort((a, b) => projeto.papeis.findIndex(p => p.papel === a.papel) - projeto.papeis.findIndex(p => p.papel === b.papel));
    return { projeto, equipe: { ...equipe, membros }, recomendacao, convites, excluidos, versao };
  }

  async criarEstado(mudanca: Mudanca): Promise<EstadoProjeto> {
    return this.db.transaction(async manager => {
      const estado = structuredClone(mudanca.estado);
      estado.versao = 1;
      await this.gravarEstado(manager, estado, mudanca.eventos, true);
      return estado;
    });
  }

  async alterarEstado(id: string, alterar: (estado: EstadoProjeto) => Promise<Mudanca>): Promise<EstadoProjeto> {
    return this.db.transaction(async manager => {
      const anterior = await this.lerEstado(manager, id, true);
      if (!anterior) throw new ErroDominio('Projeto não encontrado.', 404);
      const versaoAnterior = anterior.versao;
      const mudanca = await alterar(anterior);
      if (mudanca.estado.projeto.id !== id) throw new ErroDominio('Não é permitido trocar o identificador do projeto.');
      mudanca.estado.versao = versaoAnterior + 1;
      await this.gravarEstado(manager, mudanca.estado, mudanca.eventos, false);
      return structuredClone(mudanca.estado);
    });
  }

  private async gravarEstado(manager: EntityManager, estado: EstadoProjeto, eventos: Evento[], novo: boolean): Promise<void> {
    const { projeto, equipe, recomendacao, convites, excluidos, versao } = estado;
    if (equipe.projetoId !== projeto.id || recomendacao.projetoId !== projeto.id ||
      convites.some(c => c.projetoId !== projeto.id) || eventos.some(e => e.projetoId !== projeto.id)) {
      throw new ErroDominio('Estado contém referências a outro projeto.');
    }
    const registro: ProjetoRegistro = { ...projeto, recomendacaoAtualId: recomendacao.id, excluidos, versao };
    if (novo) await manager.insert(ProjetoEntity, registro);
    else await manager.update(ProjetoEntity, { id: projeto.id }, registro);
    const { membros, ...equipeRegistro } = equipe;
    await manager.upsert(EquipeEntity, equipeRegistro, ['id']);
    await manager.delete(MembroEntity, { equipeId: equipe.id });
    if (membros.length) await manager.insert(MembroEntity, membros.map(membro => ({
      ...membro, id: `${equipe.id}:${membro.papel}`, equipeId: equipe.id,
    })));
    await manager.createQueryBuilder().insert().into(RecomendacaoEntity).values(recomendacao).orIgnore().execute();
    // Close old invitations before inserting replacements for the same role.
    const encerrados = convites.filter(c => c.status === 'CANCELADO' || c.status === 'RECUSADO');
    const ativos = convites.filter(c => c.status === 'PENDENTE' || c.status === 'ACEITO');
    if (encerrados.length) await manager.upsert(ConviteEntity, encerrados, ['id']);
    if (ativos.length) await manager.upsert(ConviteEntity, ativos, ['id']);
    // TypeORM's recursive partial type cannot represent unknown JSONB leaves.
    if (eventos.length) await manager.insert(EventoEntity, eventos.map(evento => ({
      ...evento, status: 'PENDENTE' as const, tentativas: 0, disponivelEm: new Date(), ultimoErro: null,
    })) as QueryDeepPartialEntity<EventoRegistro>[]);
  }

  async salvarNotificacao(notificacao: Notificacao): Promise<void> {
    await this.db.createQueryBuilder().insert().into(NotificacaoEntity).values(notificacao as QueryDeepPartialEntity<Notificacao>).orIgnore().execute();
  }
  async salvarAuditoria(auditoria: Auditoria): Promise<void> {
    await this.db.createQueryBuilder().insert().into(AuditoriaEntity).values(auditoria as QueryDeepPartialEntity<Auditoria>).orIgnore().execute();
  }
  async listarNotificacoes(projetoId: string): Promise<Notificacao[]> {
    return this.db.getRepository(NotificacaoEntity).createQueryBuilder('notificacao')
      .innerJoin('EventoRegistro', 'evento', 'evento.id = notificacao."eventoId"')
      .where('evento."projetoId" = :projetoId', { projetoId }).orderBy('notificacao."criadaEm"', 'ASC').getMany();
  }
  async listarAuditoria(projetoId: string): Promise<Auditoria[]> {
    return this.db.getRepository(AuditoriaEntity).createQueryBuilder('auditoria')
      .innerJoin('EventoRegistro', 'evento', 'evento.id = auditoria."eventoId"')
      .where('evento."projetoId" = :projetoId', { projetoId }).orderBy('auditoria."criadaEm"', 'ASC').getMany();
  }

  async entregarPendentes(entregar: (evento: Evento) => Promise<{ sucesso: boolean; falhas: string[] }>, limite = 50): Promise<number> {
    let processados = 0;
    const tabela = nomeTabela((this.db.options as { schema?: string }).schema, 'outbox_eventos');
    for (let i = 0; i < limite; i++) {
      const encontrado = await this.db.transaction(async manager => {
        const rows: EventoRegistro[] = await manager.query(`SELECT * FROM ${tabela}
          WHERE status = 'PENDENTE' AND "disponivelEm" <= now()
          ORDER BY "disponivelEm", id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED`);
        const row = rows[0];
        if (!row) return false;
        const { id, tipo, projetoId, ocorridoEm, dados } = row;
        let resultado: { sucesso: boolean; falhas: string[] };
        try { resultado = await entregar({ id, tipo, projetoId, ocorridoEm, dados }); }
        catch (error) { resultado = { sucesso: false, falhas: [error instanceof Error ? error.message : String(error)] }; }
        const tentativas = row.tentativas + 1;
        const status = resultado.sucesso ? 'ENTREGUE' : tentativas >= 5 ? 'FALHO' : 'PENDENTE';
        await manager.update(EventoEntity, { id }, {
          status, tentativas, ultimoErro: resultado.sucesso ? null : resultado.falhas.join('; ').slice(0, 4000),
          disponivelEm: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** (tentativas - 1))),
        });
        return true;
      });
      if (!encontrado) break;
      processados++;
    }
    return processados;
  }

  async statusEventos(): Promise<{ pendentes: number; falhos: number }> {
    const tabela = nomeTabela((this.db.options as { schema?: string }).schema, 'outbox_eventos');
    const [contagem] = await this.db.query(`SELECT
      count(*) FILTER (WHERE status = 'PENDENTE')::integer AS pendentes,
      count(*) FILTER (WHERE status = 'FALHO')::integer AS falhos FROM ${tabela}`) as { pendentes: number; falhos: number }[];
    return contagem!;
  }
  async verificar(): Promise<void> { await this.db.query('SELECT 1'); }
}
