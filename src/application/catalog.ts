import type { ProfissionalDados } from '../domain/types.ts';

export interface CatalogoResultado { profissionais: ProfissionalDados[]; degradada: boolean; avisos: string[] }

// A leitura concorrente compartilha a mesma consulta. Uma falha não apaga o último cadastro válido.
export class CatalogoProfissionais {
  private carregar: () => Promise<ProfissionalDados[]>;
  private cache: ProfissionalDados[] | undefined;
  private atualizadoEm = 0;
  private pendente: Promise<ProfissionalDados[]> | undefined;
  private ttlMs: number;
  private maxStaleMs: number;
  private timeoutMs: number;
  private geracao = 0;
  private geracaoCache = -1;
  private sequencia = 0;

  constructor(carregar: () => Promise<ProfissionalDados[]>, opcoes: { ttlMs?: number; maxStaleMs?: number; timeoutMs?: number } = {}) {
    this.carregar = carregar;
    this.ttlMs = opcoes.ttlMs ?? 30_000;
    this.maxStaleMs = opcoes.maxStaleMs ?? 300_000;
    this.timeoutMs = opcoes.timeoutMs ?? 800;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0 || !Number.isFinite(this.maxStaleMs) || this.maxStaleMs < 0 || !Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Prazos do catálogo precisam ser finitos e não negativos; timeout deve ser positivo');
    }
  }

  invalidar(): void { this.geracao++; this.pendente = undefined; }

  async consultar(): Promise<CatalogoResultado> {
    if (this.cache && this.geracaoCache === this.geracao && Date.now() - this.atualizadoEm < this.ttlMs) {
      return { profissionais: this.cache, degradada: false, avisos: [] };
    }
    if (!this.pendente) {
      const geracao = this.geracao;
      const sequencia = ++this.sequencia;
      const leitura = Promise.resolve().then(this.carregar).then(dados => {
        if (geracao === this.geracao && sequencia === this.sequencia) {
          this.cache = dados; this.atualizadoEm = Date.now(); this.geracaoCache = geracao;
        }
        return dados;
      }).finally(() => { if (this.pendente === leitura) this.pendente = undefined; });
      this.pendente = leitura;
    }
    const geracao = this.geracao;
    const leitura = this.pendente;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const profissionais = await Promise.race([
        leitura,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo de consulta excedido')), this.timeoutMs); }),
      ]);
      if (geracao !== this.geracao) return this.consultar();
      return { profissionais, degradada: false, avisos: [] };
    } catch {
      // Uma consulta que nunca responde não prende todas as leituras seguintes.
      if (this.pendente === leitura) this.pendente = undefined;
      const utilizavel = this.cache && Date.now() - this.atualizadoEm <= this.maxStaleMs;
      return {
        profissionais: utilizavel ? this.cache! : [], degradada: true,
        avisos: [utilizavel ? 'Cadastro indisponível; usando a última leitura válida. Confirme a disponibilidade antes de convidar.' : 'Cadastro indisponível e sem cache válido; recomendação parcial sem novos membros.'],
      };
    } finally { clearTimeout(timer); }
  }
}
