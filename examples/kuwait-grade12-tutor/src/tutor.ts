import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { SUBJECTS, WEEKS_PER_TERM, findSubject, findUnit, unitForWeek } from './curriculum.ts'

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/** أدوات المنهج التي يستخدمها البوت ليبقى ملتزماً بالمقرر الكويتي */
export const curriculumServer = createSdkMcpServer({
  name: 'curriculum',
  version: '1.0.0',
  tools: [
    tool('list_subjects', 'قائمة مواد الصف الثاني عشر ووحداتها (معرف وعنوان كل وحدة)', {}, async () =>
      text(
        SUBJECTS.map(s => ({
          id: s.id,
          name: s.name,
          track: s.track,
          units: s.units.map(u => ({ id: u.id, title: u.title, term: u.term })),
        })),
      ),
    ),
    tool(
      'get_unit',
      'تفاصيل وحدة دراسية: موضوعاتها وأسلوب شرح المادة',
      { unit_id: z.string().describe('معرف الوحدة مثل physics-1') },
      async ({ unit_id }) => {
        const found = findUnit(unit_id)
        if (!found) return text(`لا توجد وحدة بالمعرف ${unit_id}`)
        return text({ subject: found.subject.name, style: found.subject.style, ...found.unit })
      },
    ),
    tool(
      'unit_for_week',
      `الوحدة المقررة لمادة ما في أسبوع معين من الفصل (1–${WEEKS_PER_TERM})`,
      {
        subject: z.string().describe('معرف المادة أو اسمها'),
        term: z.union([z.literal(1), z.literal(2)]),
        week: z.number().int().min(1).max(WEEKS_PER_TERM),
      },
      async ({ subject, term, week }) => {
        const s = findSubject(subject)
        if (!s) return text(`لا توجد مادة باسم ${subject}`)
        return text(unitForWeek(s, term, week))
      },
    ),
  ],
})

export interface AskOptions {
  prompt: string
  systemPrompt: string
  /** لمتابعة نفس المحادثة (تستخدمها النافذة الصوتية) */
  resume?: string
  signal?: AbortSignal
}

export type TutorEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'done'; costUsd?: number }
  | { type: 'error'; message: string }

/**
 * يشغّل البوت ويبث النص أولاً بأول. لا يملك البوت أي أدوات على الجهاز
 * (لا ملفات ولا أوامر) — فقط أدوات المنهج أعلاه.
 */
export async function* ask({ prompt, systemPrompt, resume, signal }: AskOptions): AsyncGenerator<TutorEvent> {
  const abortController = new AbortController()
  signal?.addEventListener('abort', () => abortController.abort())

  try {
    for await (const m of query({
      prompt,
      options: {
        systemPrompt,
        model: process.env.TUTOR_MODEL || undefined,
        tools: [],
        mcpServers: { curriculum: curriculumServer },
        allowedTools: ['mcp__curriculum__list_subjects', 'mcp__curriculum__get_unit', 'mcp__curriculum__unit_for_week'],
        settingSources: [],
        includePartialMessages: true,
        maxTurns: 6,
        resume,
        abortController,
      },
    })) {
      if (m.type === 'system' && m.subtype === 'init') {
        yield { type: 'session', sessionId: m.session_id }
      } else if (m.type === 'stream_event') {
        const e = m.event
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
          yield { type: 'text', text: e.delta.text }
        } else if (e.type === 'message_start') {
          // فصل نصوص الأدوار المتتالية (قبل وبعد استدعاء أداة)
          yield { type: 'text', text: '\n\n' }
        }
      } else if (m.type === 'result') {
        if (m.subtype !== 'success') {
          yield { type: 'error', message: `توقف البوت: ${m.subtype}` }
        }
        yield { type: 'done', costUsd: m.total_cost_usd }
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }
}
