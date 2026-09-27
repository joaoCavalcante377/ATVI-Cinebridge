import { createHash } from 'node:crypto';
import type { Auditoria, Evento, Notificacao } from '../domain/types.ts';
import type { Observador } from '../infrastructure/event-bus.ts';

export interface DestinoNotificacoes { salvarNotificacao(notificacao: Notificacao): Promise<void> }
export interface DestinoAuditoria { salvarAuditoria(auditoria: Auditoria): Promise<void> }

async function notificar(
  destino: DestinoNotificacoes, canal: Notificacao['canal'], evento: Evento, signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const destinatarios = evento.dados.destinatarios;
  if (!Array.isArray(destinatarios)) return;
  for (const destinatario of new Set(destinatarios.filter((valor): valor is string => typeof valor === 'string' && valor.length > 0))) {
    signal.throwIfAborted();
    const id = createHash('sha256').update(JSON.stringify([evento.id, canal, destinatario])).digest('hex');
    await destino.salvarNotificacao({
      id, eventoId: evento.id, canal, destinatario,
      assunto: evento.tipo, dados: structuredClone(evento.dados), criadaEm: evento.ocorridoEm,
    });
  }
}

/** Caixa de saída local de e-mail. Não envia mensagens a um provedor SMTP. */
export class NotificadorEmail implements Observador {
  readonly nome = 'notificador-email';
  private destino: DestinoNotificacoes;
  constructor(destino: DestinoNotificacoes) { this.destino = destino; }
  async atualizar(evento: Evento, signal: AbortSignal): Promise<void> {
    await notificar(this.destino, 'email', evento, signal);
  }
}

export class NotificadorInterno implements Observador {
  readonly nome = 'notificador-interno';
  private destino: DestinoNotificacoes;
  constructor(destino: DestinoNotificacoes) { this.destino = destino; }
  async atualizar(evento: Evento, signal: AbortSignal): Promise<void> {
    await notificar(this.destino, 'interno', evento, signal);
  }
}

export class AuditoriaRecomendacao implements Observador {
  readonly nome = 'auditoria-recomendacao';
  private destino: DestinoAuditoria;
  constructor(destino: DestinoAuditoria) { this.destino = destino; }
  async atualizar(evento: Evento, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.destino.salvarAuditoria({
      id: `auditoria:${evento.id}`, eventoId: evento.id,
      evento: structuredClone(evento), criadaEm: evento.ocorridoEm,
    });
  }
}
