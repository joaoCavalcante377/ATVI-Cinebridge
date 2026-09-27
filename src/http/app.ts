import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { ErroDominio } from '../domain/types.ts';
import type { Papel, ProfissionalDados } from '../domain/types.ts';
import { Projeto, Profissional, ValidadorConsistencia, CalculadorCompatibilidade, GeradorRelatorio } from '../domain/index.ts';
import type { Repositorio } from '../application/ports.ts';
import { ServicoEquipes } from '../application/service.ts';
import type { NovoProjeto, AlteracaoProjeto } from '../application/service.ts';
import { CatalogoProfissionais } from '../application/catalog.ts';
import { NotificadorEmail, NotificadorInterno, AuditoriaRecomendacao } from '../application/observers.ts';
import { BusEventos } from '../infrastructure/event-bus.ts';
import { ProcessadorEventos } from '../infrastructure/worker.ts';
import * as schemas from './schemas.ts';

export function criarApp(repositorio: Repositorio, opcoes: { logger?: boolean; worker?: boolean; catalogo?: CatalogoProfissionais } = {}) {
  const app = Fastify({
    logger: opcoes.logger ?? true, bodyLimit: 256 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const catalogo = opcoes.catalogo ?? new CatalogoProfissionais(() => repositorio.listarProfissionais());
  const servico = new ServicoEquipes(repositorio, catalogo);
  const bus = new BusEventos({ timeoutMs: 2_000, tentativas: 2, onError: falha => { app.log.error(falha, 'Falha em observador'); } });
  bus.assinar(new NotificadorEmail(repositorio));
  bus.assinar(new NotificadorInterno(repositorio));
  bus.assinar(new AuditoriaRecomendacao(repositorio));
  const worker = new ProcessadorEventos(repositorio, bus, erro => { app.log.error({ err: erro }, 'Falha ao processar eventos'); });
  if (opcoes.worker !== false) app.addHook('onReady', async () => { worker.iniciar(); });
  app.addHook('onClose', async () => { await worker.fechar(); });

  app.setErrorHandler((falha, request, reply) => {
    const erro = falha instanceof Error ? falha : new Error(String(falha));
    if (erro instanceof ErroDominio) return reply.code(erro.status).send({ erro: erro.message });
    if ('validation' in erro && erro.validation) return reply.code(400).send({ erro: 'Dados inválidos', detalhes: erro.validation });
    const codigo = (erro as { code?: string; driverError?: { code?: string } }).driverError?.code ?? (erro as { code?: string }).code;
    if (codigo === '23505') return reply.code(409).send({ erro: 'Registro já existe' });
    if (codigo === '23503' || codigo === '23514') return reply.code(422).send({ erro: 'Dados violam uma restrição do cadastro' });
    request.log.error({ err: erro }, 'Operação não concluída');
    if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '08006', '53300', '57014'].includes(codigo ?? '')) {
      return reply.code(503).send({ erro: 'Persistência indisponível. Nenhuma confirmação foi emitida.' });
    }
    if ('statusCode' in erro && typeof erro.statusCode === 'number' && erro.statusCode >= 400 && erro.statusCode < 500) {
      return reply.code(erro.statusCode).send({ erro: erro.message });
    }
    return reply.code(500).send({ erro: 'Não foi possível concluir a operação' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try { await repositorio.verificar(); return { status: 'ok', eventos: await repositorio.statusEventos() }; }
    catch { return reply.code(503).send({ status: 'indisponivel' }); }
  });
  app.post<{ Body: Omit<ProfissionalDados, 'id'> }>('/profissionais', { schema: { body: schemas.profissionalSchema } }, async (request, reply) => {
    const profissional: ProfissionalDados = { ...request.body, id: randomUUID() };
    const erros = new Profissional(profissional).aceitar(new ValidadorConsistencia());
    if (erros.length) throw new ErroDominio(erros.join(' '));
    await repositorio.salvarProfissional(profissional); catalogo.invalidar();
    request.log.info({ acao: 'profissional.cadastrado', profissionalId: profissional.id }, 'Cadastro concluído');
    return reply.code(201).send(profissional);
  });
  app.post<{ Body: NovoProjeto }>('/projetos', { schema: { body: schemas.projetoSchema } }, async (request, reply) => {
    return reply.code(201).send(await servico.criar(request.body));
  });
  app.get<{ Params: { id: string } }>('/projetos/:id', { schema: { params: schemas.idParams } }, async request => servico.buscar(request.params.id));
  app.post<{ Params: { id: string }; Body: { papeis?: Papel[] } }>('/projetos/:id/aceitar', { schema: { params: schemas.idParams, body: schemas.aceitarSchema } },
    async request => servico.aceitar(request.params.id, request.body.papeis));
  app.post<{ Params: { id: string; papel: Papel }; Body: { profissionalId?: string } }>('/projetos/:id/membros/:papel/substituir',
    { schema: { params: schemas.membroParams, body: schemas.substituirSchema } },
    async request => servico.substituir(request.params.id, request.params.papel, request.body.profissionalId));
  app.post<{ Params: { id: string; conviteId: string }; Body: { profissionalId: string; resposta: 'ACEITO' | 'RECUSADO' } }>('/projetos/:id/convites/:conviteId/resposta',
    { schema: { params: schemas.conviteParams, body: schemas.respostaSchema } },
    async request => servico.responder(request.params.id, request.params.conviteId, request.body.profissionalId, request.body.resposta));
  app.post<{ Params: { id: string }; Body: AlteracaoProjeto }>('/projetos/:id/reavaliar', { schema: { params: schemas.idParams, body: schemas.reavaliarSchema } },
    async request => servico.reavaliar(request.params.id, request.body));
  app.get<{ Params: { id: string } }>('/projetos/:id/notificacoes', { schema: { params: schemas.idParams } }, async request => {
    await servico.buscar(request.params.id); return repositorio.listarNotificacoes(request.params.id);
  });
  app.get<{ Params: { id: string } }>('/projetos/:id/auditoria', { schema: { params: schemas.idParams } }, async request => {
    await servico.buscar(request.params.id); return repositorio.listarAuditoria(request.params.id);
  });
  app.get<{ Params: { id: string } }>('/projetos/:id/relatorio', { schema: { params: schemas.idParams } }, async request => {
    const estado = await servico.buscar(request.params.id);
    const dados = await catalogo.consultar();
    const projeto = new Projeto(estado.projeto);
    return {
      texto: projeto.aceitar(new GeradorRelatorio(estado.equipe, dados.profissionais)),
      inconsistencias: projeto.aceitar(new ValidadorConsistencia(estado.equipe)),
      compatibilidade: projeto.aceitar(new CalculadorCompatibilidade(estado.projeto, dados.profissionais, estado.equipe)),
      degradada: dados.degradada, avisos: dados.avisos,
    };
  });
  return { app, servico, catalogo, worker };
}
