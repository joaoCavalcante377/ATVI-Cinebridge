import { ErroDominio } from '../src/domain/types.ts';
import type { Auditoria, EstadoProjeto, Evento, Notificacao, ProfissionalDados } from '../src/domain/types.ts';
import type { Mudanca, Repositorio } from '../src/application/ports.ts';
import type { NovoProjeto } from '../src/application/service.ts';

export function profissional(id = 'diretor-1', alteracoes: Partial<ProfissionalDados> = {}): ProfissionalDados {
  return {
    id, nome: id, email: `${id}@example.test`, papeis: ['DIRETOR'],
    competencias: [{ nome: 'direção', nivel: 5 }], precoCentavos: 10_000,
    disponibilidade: { inicio: '2026-01-01', fim: '2027-12-31' }, localizacao: 'São Paulo',
    historico: [{ genero: 'drama', tipoCaptacao: 'ficcao', papel: 'DIRETOR' }],
    avaliacoes: [{ nota: 5, comentario: 'Bom trabalho', data: '2026-08-01' }], ...alteracoes,
  };
}

export function projeto(alteracoes: Partial<NovoProjeto> = {}): NovoProjeto {
  return {
    titulo: 'Curta da turma', genero: 'drama', duracaoMinutos: 12, orcamentoCentavos: 100_000,
    inicio: '2026-10-01', prazo: '2026-10-15', tipoCaptacao: 'ficcao', localizacao: 'São Paulo',
    papeis: [{ papel: 'DIRETOR', peso: 2, competencias: [{ nome: 'direção', nivel: 5 }] },
      { papel: 'EDITOR', peso: 1, competencias: [{ nome: 'montagem', nivel: 5 }] }],
    estrategia: 'cosseno', ...alteracoes,
  };
}

export function profissionais(): ProfissionalDados[] {
  return [profissional(), profissional('diretor-2', { competencias: [{ nome: 'direção', nivel: 3 }], precoCentavos: 8_000 }),
    profissional('editor-1', { papeis: ['EDITOR'], competencias: [{ nome: 'montagem', nivel: 5 }] }),
    profissional('editor-2', { papeis: ['EDITOR'], competencias: [{ nome: 'montagem', nivel: 3 }], precoCentavos: 8_000 })];
}

/** Dublê transacional: callbacks trabalham sobre cópia e só o commit publica estado/eventos. */
export class RepositorioMemoria implements Repositorio {
  profissionais = profissionais();
  estados = new Map<string, EstadoProjeto>();
  eventos: Evento[] = [];
  notificacoes = new Map<string, Notificacao>();
  auditorias = new Map<string, Auditoria>();
  falharCommit = false;
  falharLeitura = false;
  private entregues = new Set<string>();
  private falhos = new Set<string>();
  private travas = new Map<string, Promise<void>>();

  async listarProfissionais(): Promise<ProfissionalDados[]> {
    if (this.falharLeitura) throw new Error('Cadastro indisponível');
    return structuredClone(this.profissionais);
  }
  async salvarProfissional(valor: ProfissionalDados): Promise<void> {
    this.profissionais = [...this.profissionais.filter((p) => p.id !== valor.id), structuredClone(valor)];
  }
  async buscarEstado(id: string): Promise<EstadoProjeto | null> { return structuredClone(this.estados.get(id) ?? null); }
  private commit(mudanca: Mudanca): EstadoProjeto {
    if (this.falharCommit) throw new Error('Commit recusado');
    this.estados.set(mudanca.estado.projeto.id, structuredClone(mudanca.estado));
    this.eventos.push(...structuredClone(mudanca.eventos));
    return structuredClone(mudanca.estado);
  }
  async criarEstado(mudanca: Mudanca): Promise<EstadoProjeto> { return this.commit(mudanca); }
  async alterarEstado(id: string, alterar: (estado: EstadoProjeto) => Promise<Mudanca>): Promise<EstadoProjeto> {
    const anterior = this.travas.get(id) ?? Promise.resolve();
    let liberar!: () => void;
    const trava = new Promise<void>((resolve) => { liberar = resolve; });
    const fila = anterior.then(() => trava);
    this.travas.set(id, fila);
    await anterior;
    try {
      const estado = await this.buscarEstado(id);
      if (!estado) throw new ErroDominio('Projeto não encontrado', 404);
      const mudanca = await alterar(estado);
      mudanca.estado.versao++;
      return this.commit(mudanca);
    } finally {
      liberar();
      if (this.travas.get(id) === fila) this.travas.delete(id);
    }
  }
  async salvarNotificacao(n: Notificacao): Promise<void> { this.notificacoes.set(n.id, structuredClone(n)); }
  async salvarAuditoria(a: Auditoria): Promise<void> { this.auditorias.set(a.id, structuredClone(a)); }
  async listarNotificacoes(id: string): Promise<Notificacao[]> {
    const ids = new Set(this.eventos.filter((e) => e.projetoId === id).map((e) => e.id));
    return structuredClone([...this.notificacoes.values()].filter((n) => ids.has(n.eventoId)));
  }
  async listarAuditoria(id: string): Promise<Auditoria[]> {
    return structuredClone([...this.auditorias.values()].filter((a) => a.evento.projetoId === id));
  }
  async entregarPendentes(entregar: (evento: Evento) => Promise<{ sucesso: boolean; falhas: string[] }>, limite = 100): Promise<number> {
    const lote = this.eventos.filter((e) => !this.entregues.has(e.id)).slice(0, limite);
    for (const evento of lote) {
      if ((await entregar(structuredClone(evento))).sucesso) { this.entregues.add(evento.id); this.falhos.delete(evento.id); }
      else this.falhos.add(evento.id);
    }
    return lote.length;
  }
  async statusEventos(): Promise<{ pendentes: number; falhos: number }> {
    return { pendentes: this.eventos.filter((e) => !this.entregues.has(e.id)).length, falhos: this.falhos.size };
  }
  async verificar(): Promise<void> {}
}
