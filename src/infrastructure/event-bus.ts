import { EventEmitter } from 'node:events';
import type { Evento } from '../domain/types.ts';

export interface Observador {
  nome: string;
  atualizar(evento: Evento, signal: AbortSignal): Promise<void> | void;
}

export interface RegistroEntregas {
  foiEntregue(eventoId: string, observador: string): Promise<boolean>;
  registrarEntrega(eventoId: string, observador: string): Promise<void>;
}

export interface FalhaEntrega {
  eventoId: string;
  observador: string;
  tentativa: number;
  erro: unknown;
}

interface Opcoes {
  timeoutMs?: number;
  tentativas?: number;
  cacheMaximo?: number;
  entregas?: RegistroEntregas;
  onError?: (falha: FalhaEntrega) => Promise<void> | void;
}

export interface ResultadoPublicacao { sucesso: boolean; falhas: string[] }
interface Contexto {
  evento: Evento;
  entregas: { nome: string; promessa: Promise<string | undefined> }[];
}

/** EventEmitter despacha; as promises registradas pelos listeners controlam a conclusão. */
export class BusEventos {
  private emitter = new EventEmitter();
  private listeners = new Map<string, (contexto: Contexto) => void>();
  private concluidas = new Map<string, Set<string>>();
  private pendentes = new Map<string, Promise<ResultadoPublicacao>>();
  private encerrando = false;
  private opcoes: Required<Pick<Opcoes, 'timeoutMs' | 'tentativas' | 'cacheMaximo'>> & Opcoes;

  constructor(opcoes: Opcoes = {}) {
    this.opcoes = { timeoutMs: 2_000, tentativas: 3, cacheMaximo: 1_000, ...opcoes };
    for (const campo of ['timeoutMs', 'tentativas', 'cacheMaximo'] as const) {
      if (!Number.isInteger(this.opcoes[campo]) || this.opcoes[campo] < 1) {
        throw new Error(`${campo} precisa ser um inteiro positivo`);
      }
    }
  }

  assinar(observador: Observador): () => void {
    if (this.encerrando) throw new Error('Barramento encerrado');
    if (!observador.nome.trim() || this.listeners.has(observador.nome)) {
      throw new Error('Observador precisa ter um nome único e não vazio');
    }
    const listener = (contexto: Contexto): void => {
      contexto.entregas.push({ nome: observador.nome, promessa: this.entregar(observador, contexto.evento) });
    };
    this.listeners.set(observador.nome, listener);
    this.emitter.on('publicacao', listener);
    return () => {
      this.emitter.off('publicacao', listener);
      if (this.listeners.get(observador.nome) === listener) this.listeners.delete(observador.nome);
    };
  }

  publicar(evento: Evento): Promise<ResultadoPublicacao> {
    if (this.encerrando) return Promise.reject(new Error('Barramento encerrado'));
    const existente = this.pendentes.get(evento.id);
    if (existente) return existente;
    const publicacao = this.despachar(evento).finally(() => { this.pendentes.delete(evento.id); });
    this.pendentes.set(evento.id, publicacao);
    return publicacao;
  }

  private async despachar(evento: Evento): Promise<ResultadoPublicacao> {
    const contexto: Contexto = { evento, entregas: [] };
    await new Promise<void>((resolve) => setImmediate(() => {
      this.emitter.emit('publicacao', contexto);
      resolve();
    }));
    const resultados = await Promise.allSettled(contexto.entregas.map((entrega) => entrega.promessa));
    const falhas = resultados.flatMap((resultado, index) => {
      if (resultado.status === 'rejected') return [contexto.entregas[index]!.nome];
      return resultado.value === undefined ? [] : [resultado.value];
    });
    return { sucesso: falhas.length === 0, falhas };
  }

  private async entregar(observador: Observador, evento: Evento): Promise<string | undefined> {
    if (this.concluidas.get(evento.id)?.has(observador.nome)) return;
    for (let tentativa = 1; tentativa <= this.opcoes.tentativas; tentativa++) {
      try {
        await this.comPrazo(observador, evento);
        this.registrarNoCache(evento.id, observador.nome);
        return;
      } catch (erro) {
        // Um logger com defeito também não pode interromper os outros observadores.
        try {
          void Promise.resolve(this.opcoes.onError?.({ eventoId: evento.id, observador: observador.nome, tentativa, erro }))
            .catch(() => undefined);
        }
        catch { /* A falha original continua indicada no resultado da publicação. */ }
      }
    }
    return observador.nome;
  }

  private async comPrazo(observador: Observador, evento: Evento): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const erro = new Error(`Prazo excedido: ${observador.nome}`);
        controller.abort(erro);
        reject(erro);
      }, this.opcoes.timeoutMs);
    });
    // A microtask também transforma throws síncronos em rejeições observadas.
    const operacao = Promise.resolve().then(async () => {
      if (!await this.opcoes.entregas?.foiEntregue(evento.id, observador.nome)) {
        controller.signal.throwIfAborted();
        await observador.atualizar(evento, controller.signal);
        controller.signal.throwIfAborted();
        await this.opcoes.entregas?.registrarEntrega(evento.id, observador.nome);
      }
    });
    try { await Promise.race([operacao, prazo]); }
    finally { clearTimeout(timer); }
    // AbortSignal é cooperativo: uma operação que ignora o sinal pode terminar depois
    // do timeout. Por isso os destinos devem aceitar entregas idempotentes.
  }

  private registrarNoCache(eventoId: string, observador: string): void {
    const nomes = this.concluidas.get(eventoId) ?? new Set<string>();
    nomes.add(observador);
    this.concluidas.delete(eventoId);
    this.concluidas.set(eventoId, nomes);
    while (this.concluidas.size > this.opcoes.cacheMaximo) {
      const primeiro = this.concluidas.keys().next().value;
      if (primeiro !== undefined) this.concluidas.delete(primeiro);
    }
  }

  /** Espera as publicações aceitas, limitadas pelos prazos de seus observadores. */
  async fechar(): Promise<void> {
    this.encerrando = true;
    await Promise.allSettled([...this.pendentes.values()]);
    this.emitter.removeAllListeners();
    this.listeners.clear();
    this.concluidas.clear();
  }
}
