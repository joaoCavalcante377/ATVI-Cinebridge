import type { ProjetoDados, ProfissionalDados } from './types.ts';

/** As operações transversais ficam nos visitantes; entidades só fazem o despacho. */
export interface VisitanteProjeto<T> {
  visitarProjeto(projeto: Projeto): T;
  visitarProfissional(profissional: Profissional): T;
}

export class Projeto {
  readonly dados: ProjetoDados;
  constructor(dados: ProjetoDados) { this.dados = dados; }
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProjeto(this); }
}

export class Profissional {
  readonly dados: ProfissionalDados;
  constructor(dados: ProfissionalDados) { this.dados = dados; }
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProfissional(this); }
}
