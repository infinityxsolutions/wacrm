import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

/** One business-specific knowledge-base document the AI answers from. */
export interface GeneratedDoc {
  title: string
  content: string
}

export interface GeneratedQuickReply {
  title: string
  content_text: string
}

export interface GeneratedPipeline {
  name: string
  stages: { name: string; color: string }[]
}

export interface GeneratedTag {
  name: string
  color: string
}

/** Everything an industry pack builds from a business's answers. */
export interface AutopilotSetup {
  /** Business instructions for the AI agent (Settings → Agent setup). */
  systemPrompt: string
  knowledge: GeneratedDoc[]
  quickReplies: GeneratedQuickReply[]
  pipeline: GeneratedPipeline
  tags: GeneratedTag[]
  /** WhatsApp templates ready to submit to Meta for approval. */
  templates: TemplatePayload[]
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }
