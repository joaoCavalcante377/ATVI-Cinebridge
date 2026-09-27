import type { Repositorio } from '../application/ports.ts';
import type { BusEventos } from './event-bus.ts';

export class ProcessadorEventos {
  private repositorio: Repositorio;
  private bus: BusEventos;
  private onError: (erro: unknown) => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendente: Promise<number> | undefined;

  constructor(repositorio: Repositorio, bus: BusEventos, onError: (erro: unknown) => void = () => {}) {
    this.repositorio = repositorio; this.bus = bus; this.onError = onError;
  }
  iniciar(intervaloMs = 200): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.processar().catch(erro => {
        try { void Promise.resolve(this.onError(erro)).catch(() => undefined); }
        catch { /* O erro de um logger não deve derrubar o worker. */ }
      });
    }, intervaloMs);
    this.timer.unref();
  }
  processar(): Promise<number> {
    if (!this.pendente) this.pendente = this.repositorio.entregarPendentes(e => this.bus.publicar(e), 100)
      .finally(() => { this.pendente = undefined; });
    return this.pendente;
  }
  async fechar(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined;
    try { await this.pendente; }
    finally { await this.bus.fechar(); }
  }
}
