import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseWithEscalation,
  FakeLlmClient,
  AnthropicLlmClient,
  type ListingLlmClient,
  type ParseResult,
} from '../../core';

/**
 * NestJS adapter over the framework-agnostic listing parser.
 *
 * All the real logic — extraction, normalization, validation, confidence-based
 * model escalation — lives in `src/core` and is unit-tested there with no
 * network. This service just selects the LLM backend from config and delegates.
 *
 * When ANTHROPIC_API_KEY is present it parses with live Claude (Haiku → Sonnet →
 * Opus escalation); otherwise it falls back to the deterministic fake so the
 * service is still constructible in environments without a key.
 */
@Injectable()
export class AiParserService {
  private readonly logger = new Logger(AiParserService.name);
  private readonly llm: ListingLlmClient;

  constructor(config: ConfigService) {
    const key = config.get<string>('ANTHROPIC_API_KEY');
    if (key) {
      this.llm = new AnthropicLlmClient(key);
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — using deterministic fake LLM');
      this.llm = new FakeLlmClient();
    }
  }

  /** Parse a free-form WhatsApp broadcast into a validated, typed listing. */
  parse(text: string): Promise<ParseResult> {
    return parseWithEscalation(text, this.llm);
  }
}
