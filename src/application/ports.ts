import type { Auditoria, EstadoProjeto, Evento, Notificacao, ProfissionalDados } from '../domain/types.ts';

export interface Mudanca { estado: EstadoProjeto; eventos: Evento[] }
export interface Repositorio {
  listarProfissionais(): Promise<ProfissionalDados[]>;
  salvarProfissional(profissional: ProfissionalDados): Promise<void>;
  buscarEstado(id: string): Promise<EstadoProjeto | null>;
  criarEstado(mudanca: Mudanca): Promise<EstadoProjeto>;
  alterarEstado(id: string, alterar: (estado: EstadoProjeto) => Promise<Mudanca>): Promise<EstadoProjeto>;
  salvarNotificacao(notificacao: Notificacao): Promise<void>;
  salvarAuditoria(auditoria: Auditoria): Promise<void>;
  listarNotificacoes(projetoId: string): Promise<Notificacao[]>;
  listarAuditoria(projetoId: string): Promise<Auditoria[]>;
  entregarPendentes(entregar: (evento: Evento) => Promise<{ sucesso: boolean; falhas: string[] }>, limite?: number): Promise<number>;
  statusEventos(): Promise<{ pendentes: number; falhos: number }>;
  verificar(): Promise<void>;
}
