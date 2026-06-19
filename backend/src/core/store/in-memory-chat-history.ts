/**
 * In-memory chat-history store — provenance for every listing.
 *
 * Each listing must carry the WhatsApp messages that produced it (audit trail:
 * who submitted what, and the exact text the parse came from). History is keyed
 * by the same listing key as the record, so the write-order invariant can assert
 * "history exists before the record is created." See [[write-order]].
 */

export interface ChatMessage {
  from: string;
  text: string;
  timestamp?: string;
}

export class InMemoryChatHistoryStore {
  private readonly log = new Map<string, ChatMessage[]>();

  append(key: string, messages: ChatMessage[]): void {
    const existing = this.log.get(key) ?? [];
    this.log.set(key, [...existing, ...messages]);
  }

  has(key: string): boolean {
    return (this.log.get(key)?.length ?? 0) > 0;
  }

  get(key: string): ChatMessage[] {
    return this.log.get(key) ?? [];
  }
}
