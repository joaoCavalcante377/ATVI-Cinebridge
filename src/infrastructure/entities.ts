import { EntitySchema } from 'typeorm';
import type { Avaliacao, Competencia, Convite, Equipe, EstadoProjeto, Evento, Notificacao, ProfissionalDados, ProjetoDados, Recomendacao } from '../domain/types.ts';

export interface ProjetoRegistro extends ProjetoDados {
  recomendacaoAtualId: string;
  excluidos: EstadoProjeto['excluidos'];
  versao: number;
}
export interface ProfissionalRegistro extends Omit<ProfissionalDados, 'competencias' | 'avaliacoes'> {}
export interface CompetenciaRegistro extends Competencia { id: string; profissionalId: string }
export interface AvaliacaoRegistro extends Avaliacao { id: string; profissionalId: string }
export interface EquipeRegistro extends Omit<Equipe, 'membros'> {}
export type MembroRegistro = Equipe['membros'][number] & { id: string; equipeId: string };
export interface EventoRegistro extends Evento {
  status: 'PENDENTE' | 'ENTREGUE' | 'FALHO'; tentativas: number; disponivelEm: Date; ultimoErro: string | null;
}
export interface AuditoriaRegistro { id: string; eventoId: string; evento: Evento; criadaEm: string }
const dinheiro = { type: 'bigint' as const, transformer: { to: (valor: number) => valor, from: (valor: string) => Number(valor) } };

export const ProjetoEntity = new EntitySchema<ProjetoRegistro>({
  name: 'ProjetoRegistro', tableName: 'projetos', columns: {
    id: { type: 'text', primary: true }, titulo: { type: 'text' }, genero: { type: 'text' },
    duracaoMinutos: { type: 'double precision' }, orcamentoCentavos: dinheiro,
    inicio: { type: 'text' }, prazo: { type: 'text' }, tipoCaptacao: { type: 'text' }, localizacao: { type: 'text' },
    papeis: { type: 'jsonb' }, estrategia: { type: 'text' }, parametros: { type: 'jsonb' },
    recomendacaoAtualId: { type: 'text' }, excluidos: { type: 'jsonb' }, versao: { type: 'integer' },
  },
});
export const ProfissionalEntity = new EntitySchema<ProfissionalRegistro>({
  name: 'ProfissionalRegistro', tableName: 'profissionais', columns: {
    id: { type: 'text', primary: true }, nome: { type: 'text' }, email: { type: 'text' },
    papeis: { type: 'jsonb' }, precoCentavos: dinheiro, disponibilidade: { type: 'jsonb' },
    localizacao: { type: 'text' }, historico: { type: 'jsonb' },
  },
});
export const CompetenciaEntity = new EntitySchema<CompetenciaRegistro>({
  name: 'CompetenciaRegistro', tableName: 'competencias', columns: {
    id: { type: 'text', primary: true }, profissionalId: { type: 'text' }, nome: { type: 'text' }, nivel: { type: 'double precision' },
  },
});
export const AvaliacaoEntity = new EntitySchema<AvaliacaoRegistro>({
  name: 'AvaliacaoRegistro', tableName: 'avaliacoes', columns: {
    id: { type: 'text', primary: true }, profissionalId: { type: 'text' }, nota: { type: 'double precision' },
    comentario: { type: 'text' }, data: { type: 'text' },
  },
});
export const EquipeEntity = new EntitySchema<EquipeRegistro>({
  name: 'EquipeRegistro', tableName: 'equipes', columns: {
    id: { type: 'text', primary: true }, projetoId: { type: 'text', unique: true }, papeisPendentes: { type: 'jsonb' },
    custoCentavos: dinheiro, status: { type: 'text' },
  },
});
export const MembroEntity = new EntitySchema<MembroRegistro>({
  name: 'MembroRegistro', tableName: 'membros_equipe', columns: {
    id: { type: 'text', primary: true }, equipeId: { type: 'text' }, papel: { type: 'text' }, profissionalId: { type: 'text' },
    precoCentavos: dinheiro, pontuacao: { type: 'double precision' }, aceitoProdutor: { type: 'boolean' }, confirmado: { type: 'boolean' },
  },
});
export const RecomendacaoEntity = new EntitySchema<Recomendacao>({
  name: 'RecomendacaoRegistro', tableName: 'recomendacoes', columns: {
    id: { type: 'text', primary: true }, projetoId: { type: 'text' }, estrategia: { type: 'text' }, candidatos: { type: 'jsonb' },
    degradada: { type: 'boolean' }, avisos: { type: 'jsonb' }, criadaEm: { type: 'text' },
  },
});
export const ConviteEntity = new EntitySchema<Convite>({
  name: 'ConviteRegistro', tableName: 'convites', columns: {
    id: { type: 'text', primary: true }, projetoId: { type: 'text' }, papel: { type: 'text' }, profissionalId: { type: 'text' },
    status: { type: 'text' }, criadoEm: { type: 'text' },
  },
});
export const EventoEntity = new EntitySchema<EventoRegistro>({
  name: 'EventoRegistro', tableName: 'outbox_eventos', columns: {
    id: { type: 'text', primary: true }, tipo: { type: 'text' }, projetoId: { type: 'text' }, ocorridoEm: { type: 'text' }, dados: { type: 'jsonb' },
    status: { type: 'text' }, tentativas: { type: 'integer' }, disponivelEm: { type: 'timestamptz' }, ultimoErro: { type: 'text', nullable: true },
  },
});
export const NotificacaoEntity = new EntitySchema<Notificacao>({
  name: 'NotificacaoRegistro', tableName: 'notificacoes', columns: {
    id: { type: 'text', primary: true }, eventoId: { type: 'text' }, canal: { type: 'text' }, destinatario: { type: 'text' },
    assunto: { type: 'text' }, dados: { type: 'jsonb' }, criadaEm: { type: 'text' },
  },
});
export const AuditoriaEntity = new EntitySchema<AuditoriaRegistro>({
  name: 'AuditoriaRegistro', tableName: 'auditoria', columns: {
    id: { type: 'text', primary: true }, eventoId: { type: 'text' }, evento: { type: 'jsonb' }, criadaEm: { type: 'text' },
  },
});
export const ENTIDADES = [ProjetoEntity, ProfissionalEntity, CompetenciaEntity, AvaliacaoEntity, EquipeEntity,
  MembroEntity, RecomendacaoEntity, ConviteEntity, EventoEntity, NotificacaoEntity, AuditoriaEntity];
