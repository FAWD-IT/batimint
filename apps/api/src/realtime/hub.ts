/**
 * Concentrateur temps réel (04 « Temps réel ») : une connexion LISTEN dédiée reçoit les messages
 * publiés par le worker via pg_notify, puis les distribue aux flux SSE abonnés au canal,
 * uniquement dans le tenant de l'abonné.
 */
import { REALTIME_PG_CHANNEL, type RealtimeMessage, RealtimeMessageSchema } from '@batimint/contracts';
import pg from 'pg';

export interface Subscriber {
  /** null pour les portails externes (filtrage par canal seul, le canal porte le jeton). */
  tenantId: string | null;
  channels: Set<string>;
  send(message: RealtimeMessage): void;
}

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export class RealtimeHub {
  private client: pg.Client | null = null;
  private readonly subscribers = new Set<Subscriber>();
  private stopped = false;
  private retryMs = 500;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly connectionString: string | null,
    private readonly logger?: Logger,
  ) {}

  get size(): number {
    return this.subscribers.size;
  }

  get connected(): boolean {
    return this.client !== null;
  }

  async start(): Promise<void> {
    if (!this.connectionString) return;
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.connectionString) return;
    const client = new pg.Client({ connectionString: this.connectionString, application_name: 'batimint-realtime' });
    client.on('notification', (n) => {
      if (n.channel !== REALTIME_PG_CHANNEL || !n.payload) return;
      try {
        this.dispatch(RealtimeMessageSchema.parse(JSON.parse(n.payload)));
      } catch (err) {
        this.logger?.warn({ err }, 'message temps réel invalide ignoré');
      }
    });
    client.on('error', (err) => {
      this.logger?.warn({ err }, 'connexion LISTEN perdue, reconnexion');
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_PG_CHANNEL}`);
      this.client = client;
      this.retryMs = 500;
    } catch (err) {
      this.logger?.warn({ err }, 'LISTEN impossible, nouvel essai');
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.client = null;
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 15_000);
  }

  subscribe(sub: Subscriber): () => void {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  /** Distribue un message aux abonnés autorisés (même tenant, canal souscrit). */
  dispatch(message: RealtimeMessage): void {
    for (const sub of this.subscribers) {
      if (sub.tenantId !== null && sub.tenantId !== message.tenantId) continue;
      if (!sub.channels.has(message.channel)) continue;
      try {
        sub.send(message);
      } catch (err) {
        this.logger?.warn({ err }, 'envoi SSE impossible');
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }
}
