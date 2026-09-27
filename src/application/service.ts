import { randomUUID } from 'node:crypto';
import { ErroDominio, PARAMETROS_PADRAO } from '../domain/types.ts';
import type { EstadoProjeto, Evento, MembroEquipe, Papel, Parametros, ProfissionalDados, ProjetoDados } from '../domain/types.ts';
import { OrquestradorPadrao } from '../domain/index.ts';
import type { Repositorio } from './ports.ts';
import { CatalogoProfissionais } from './catalog.ts';
import { CacheRecomendacoes } from './recommendation-cache.ts';

export type NovoProjeto = Omit<ProjetoDados, 'id' | 'parametros'> & { parametros?: Partial<Parametros> };
export type AlteracaoProjeto = Partial<Pick<ProjetoDados, 'orcamentoCentavos' | 'inicio' | 'prazo' | 'estrategia'>> & { parametros?: Partial<Parametros> };

export function criarEvento(tipo: string, projetoId: string, dados: Record<string, unknown>): Evento {
  return { id: randomUUID(), tipo, projetoId, dados, ocorridoEm: new Date().toISOString() };
}

export class ServicoEquipes {
  private repositorio: Repositorio;
  private catalogo: CatalogoProfissionais;
  private orquestrador: OrquestradorPadrao;
  private recomendacoes: CacheRecomendacoes;

  constructor(repositorio: Repositorio, catalogo: CatalogoProfissionais, orquestrador = new OrquestradorPadrao()) {
    this.repositorio = repositorio; this.catalogo = catalogo; this.orquestrador = orquestrador;
    this.recomendacoes = new CacheRecomendacoes(orquestrador);
  }

  async criar(entrada: NovoProjeto): Promise<EstadoProjeto> {
    const projeto: ProjetoDados = { ...entrada, id: randomUUID(), parametros: { ...PARAMETROS_PADRAO, ...entrada.parametros } };
    const dados = await this.catalogo.consultar();
    const resultado = this.recomendacoes.recomendar(projeto, dados.profissionais);
    const estado: EstadoProjeto = {
      projeto, equipe: resultado.equipe, versao: 1, convites: [], excluidos: {},
      recomendacao: {
        id: randomUUID(), projetoId: projeto.id, estrategia: projeto.estrategia,
        candidatos: resultado.candidatos, degradada: dados.degradada,
        avisos: [...dados.avisos, ...resultado.avisos], criadaEm: new Date().toISOString(),
      },
    };
    return this.repositorio.criarEstado({ estado, eventos: [this.eventoRecomendacao(estado)] });
  }

  async buscar(id: string): Promise<EstadoProjeto> {
    const estado = await this.repositorio.buscarEstado(id);
    if (!estado) throw new ErroDominio('Projeto não encontrado', 404);
    return estado;
  }

  private eventoRecomendacao(estado: EstadoProjeto, papel?: Papel): Evento {
    const membros = estado.equipe.membros.filter(m => !papel || m.papel === papel);
    return criarEvento('recomendacao.gerada', estado.projeto.id, {
      recomendacaoId: estado.recomendacao.id, equipe: estado.equipe, papel,
      destinatarios: [`produtor:${estado.projeto.id}`, ...membros.map(m => `profissional:${m.profissionalId}`)],
    });
  }

  private atualizarStatus(estado: EstadoProjeto): void {
    estado.equipe.status = estado.equipe.papeisPendentes.length ? 'PARCIAL'
      : estado.equipe.membros.every(m => m.confirmado && m.aceitoProdutor) ? 'CONFIRMADA'
      : estado.equipe.membros.some(m => m.aceitoProdutor) ? 'AGUARDANDO' : 'SUGERIDA';
  }

  private cancelarConvites(estado: EstadoProjeto, papel?: Papel): Evento[] {
    const destinatarios: string[] = [];
    for (const convite of estado.convites) {
      if ((!papel || convite.papel === papel) && ['PENDENTE', 'ACEITO'].includes(convite.status)) {
        convite.status = 'CANCELADO'; destinatarios.push(`profissional:${convite.profissionalId}`);
      }
    }
    return destinatarios.length ? [criarEvento('convites.cancelados', estado.projeto.id, { papel, destinatarios })] : [];
  }

  private async recalcular(estado: EstadoProjeto, papel?: Papel, profissionalId?: string): Promise<void> {
    const dados = await this.catalogo.consultar();
    if (profissionalId && dados.degradada) throw new ErroDominio('Cadastro indisponível para validar a substituição manual', 503);
    const fixos = papel ? estado.equipe.membros.filter(m => m.papel !== papel) : [];
    const profissionais = profissionalId
      ? dados.profissionais.filter(p => p.id === profissionalId || fixos.some(m => m.profissionalId === p.id))
      : dados.profissionais;
    const resultado = this.orquestrador.orquestrar(estado.projeto, profissionais, { fixos, excluidos: estado.excluidos, cadastroIndisponivel: dados.degradada });
    if (profissionalId && !resultado.equipe.membros.some(m => m.papel === papel && m.profissionalId === profissionalId)) {
      throw new ErroDominio('O profissional não atende ao papel, disponibilidade, localização ou orçamento');
    }
    estado.equipe = { ...resultado.equipe, id: estado.equipe.id };
    estado.recomendacao = {
      id: randomUUID(), projetoId: estado.projeto.id, estrategia: estado.projeto.estrategia,
      candidatos: resultado.candidatos, degradada: dados.degradada,
      avisos: [...dados.avisos, ...resultado.avisos], criadaEm: new Date().toISOString(),
    };
    this.atualizarStatus(estado);
  }

  async aceitar(id: string, papeis?: Papel[]): Promise<EstadoProjeto> {
    // Convites exigem uma leitura válida, mesmo quando uma sugestão veio do cache de contingência.
    const dados = await this.catalogo.consultar();
    if (dados.degradada) throw new ErroDominio('Cadastro indisponível. Tente confirmar os convites novamente mais tarde.', 503);
    return this.repositorio.alterarEstado(id, async estado => {
      const escolhidos = papeis ?? estado.equipe.membros.map(m => m.papel);
      if (!escolhidos.length) throw new ErroDominio('Não há membros para convidar');
      // Revalida restrições com os integrantes fixos antes de emitir qualquer convite.
      this.orquestrador.orquestrar(estado.projeto, dados.profissionais, { fixos: estado.equipe.membros });
      const eventos: Evento[] = [];
      for (const papel of escolhidos) {
        const membro = estado.equipe.membros.find(m => m.papel === papel);
        if (!membro) throw new ErroDominio(`O papel ${papel} não tem profissional sugerido`);
        if (membro.aceitoProdutor) continue;
        membro.aceitoProdutor = true;
        const convite = { id: randomUUID(), projetoId: id, papel, profissionalId: membro.profissionalId, status: 'PENDENTE' as const, criadoEm: new Date().toISOString() };
        estado.convites.push(convite);
        eventos.push(criarEvento('convite.criado', id, { conviteId: convite.id, papel, profissionalId: membro.profissionalId, destinatarios: [`profissional:${membro.profissionalId}`] }));
      }
      this.atualizarStatus(estado);
      return { estado, eventos };
    });
  }

  async substituir(id: string, papel: Papel, profissionalId?: string): Promise<EstadoProjeto> {
    return this.repositorio.alterarEstado(id, async estado => {
      if (!estado.projeto.papeis.some(p => p.papel === papel)) throw new ErroDominio('Papel não exigido no projeto');
      const atual = estado.equipe.membros.find(m => m.papel === papel);
      if (profissionalId === atual?.profissionalId && profissionalId) throw new ErroDominio('Escolha um profissional diferente');
      const eventos = this.cancelarConvites(estado, papel);
      if (estado.equipe.status === 'CONFIRMADA') eventos.push(criarEvento('equipe.reaberta', id, { destinatarios: [`produtor:${id}`] }));
      if (atual) estado.excluidos[papel] = [...new Set([...(estado.excluidos[papel] ?? []), atual.profissionalId])];
      await this.recalcular(estado, papel, profissionalId);
      eventos.push(criarEvento('membro.substituido', id, { papel, anterior: atual?.profissionalId, solicitado: profissionalId, destinatarios: [`produtor:${id}`] }), this.eventoRecomendacao(estado, papel));
      return { estado, eventos };
    });
  }

  async responder(id: string, conviteId: string, profissionalId: string, resposta: 'ACEITO' | 'RECUSADO'): Promise<EstadoProjeto> {
    return this.repositorio.alterarEstado(id, async estado => {
      const convite = estado.convites.find(c => c.id === conviteId);
      if (!convite) throw new ErroDominio('Convite não encontrado', 404);
      if (convite.profissionalId !== profissionalId) throw new ErroDominio('O convite pertence a outro profissional', 403);
      if (convite.status === resposta) return { estado, eventos: [] };
      if (convite.status !== 'PENDENTE') throw new ErroDominio('Este convite já foi respondido ou cancelado', 409);
      const membro = estado.equipe.membros.find(m => m.papel === convite.papel && m.profissionalId === profissionalId);
      if (!membro) throw new ErroDominio('Convite não corresponde à equipe atual', 409);
      convite.status = resposta;
      const eventos = [criarEvento('convite.respondido', id, { conviteId, profissionalId, resposta, destinatarios: [`produtor:${id}`] })];
      if (resposta === 'RECUSADO') {
        estado.excluidos[convite.papel] = [...new Set([...(estado.excluidos[convite.papel] ?? []), profissionalId])];
        await this.recalcular(estado, convite.papel);
        eventos.push(this.eventoRecomendacao(estado, convite.papel));
      } else {
        membro.confirmado = true;
        this.atualizarStatus(estado);
        if (estado.equipe.status === 'CONFIRMADA') eventos.push(criarEvento('equipe.confirmada', id, {
          equipe: estado.equipe, integracoes: ['gerenciamento_projetos', 'financeiro'],
          destinatarios: [`produtor:${id}`, ...estado.equipe.membros.map(m => `profissional:${m.profissionalId}`)],
        }));
      }
      return { estado, eventos };
    });
  }

  async reavaliar(id: string, alteracao: AlteracaoProjeto): Promise<EstadoProjeto> {
    return this.repositorio.alterarEstado(id, async estado => {
      const eventos = this.cancelarConvites(estado);
      if (estado.equipe.status === 'CONFIRMADA') eventos.push(criarEvento('equipe.reaberta', id, { destinatarios: [`produtor:${id}`] }));
      estado.projeto = { ...estado.projeto, ...alteracao, parametros: { ...estado.projeto.parametros, ...alteracao.parametros } };
      await this.recalcular(estado);
      eventos.push(criarEvento('projeto.reavaliado', id, { alteracao, destinatarios: [`produtor:${id}`] }), this.eventoRecomendacao(estado));
      return { estado, eventos };
    });
  }
}
