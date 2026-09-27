export const PAPEIS = ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR', 'ROTEIRISTA', 'EFEITOS_VISUAIS'] as const;
export type Papel = typeof PAPEIS[number];
export const ESTRATEGIAS = ['cosseno', 'colaborativa', 'orcamento'] as const;
export type Estrategia = typeof ESTRATEGIAS[number];
export type TipoCaptacao = 'documentario' | 'ficcao' | 'animacao';
export interface Competencia { nome: string; nivel: number }
export interface Avaliacao { nota: number; comentario: string; data: string }
export interface Historico { genero: string; tipoCaptacao: TipoCaptacao; papel: Papel; projetoId?: string; nota?: number }
export interface ProfissionalDados {
  id: string; nome: string; email: string; papeis: Papel[]; competencias: Competencia[];
  precoCentavos: number; disponibilidade: { inicio: string; fim: string }; localizacao: string;
  historico: Historico[]; avaliacoes: Avaliacao[];
}
export interface RequisitoPapel { papel: Papel; peso: number; competencias: Competencia[] }
export interface Parametros {
  pesoCompetencia: number; pesoAvaliacao: number; pesoPreco: number; limiteCandidatos: number;
}
export const PARAMETROS_PADRAO: Parametros = {
  pesoCompetencia: 0.65, pesoAvaliacao: 0.25, pesoPreco: 0.1, limiteCandidatos: 10,
};
export interface ProjetoDados {
  id: string; titulo: string; genero: string; duracaoMinutos: number; orcamentoCentavos: number;
  inicio: string; prazo: string; tipoCaptacao: TipoCaptacao; localizacao: string;
  papeis: RequisitoPapel[]; estrategia: Estrategia; parametros: Parametros;
}
export interface Candidato {
  profissionalId: string; nome: string; precoCentavos: number; pontuacao: number; motivos: string[];
}
export type Ranking = Partial<Record<Papel, Candidato[]>>;
export interface MembroEquipe {
  papel: Papel; profissionalId: string; precoCentavos: number; pontuacao: number;
  aceitoProdutor: boolean; confirmado: boolean;
}
export interface Equipe {
  id: string; projetoId: string; membros: MembroEquipe[]; papeisPendentes: Papel[];
  custoCentavos: number; status: 'PARCIAL' | 'SUGERIDA' | 'AGUARDANDO' | 'CONFIRMADA';
}
export interface Recomendacao {
  id: string; projetoId: string; estrategia: Estrategia; candidatos: Ranking;
  degradada: boolean; avisos: string[]; criadaEm: string;
}
export interface Convite {
  id: string; projetoId: string; papel: Papel; profissionalId: string;
  status: 'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO'; criadoEm: string;
}
export interface EstadoProjeto {
  projeto: ProjetoDados; equipe: Equipe; recomendacao: Recomendacao; convites: Convite[];
  excluidos: Partial<Record<Papel, string[]>>; versao: number;
}
export interface Evento {
  id: string; tipo: string; projetoId: string; ocorridoEm: string; dados: Record<string, unknown>;
}
export interface Notificacao {
  id: string; eventoId: string; canal: 'email' | 'interno'; destinatario: string;
  assunto: string; dados: Record<string, unknown>; criadaEm: string;
}
export interface Auditoria { id: string; eventoId: string; evento: Evento; criadaEm: string }
export class ErroDominio extends Error {
  status: number;
  constructor(message: string, status = 422) { super(message); this.name = 'ErroDominio'; this.status = status; }
}
