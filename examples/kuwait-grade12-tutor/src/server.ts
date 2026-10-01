/**
 * خادم الويب: يقدّم واجهة البوت (public/index.html) ويبث ردود البوت عبر SSE.
 *
 * تشغيل:  ANTHROPIC_API_KEY=... npm start   ثم افتح http://localhost:3000
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SUBJECTS, findSubject, findUnit } from './curriculum.ts'
import { SYSTEM_PROMPT, VOICE_SYSTEM_PROMPT, buildTaskPrompt, buildVoicePrompt, type TaskKind, TASK_LABELS } from './prompts.ts'
import { ask, type TutorEvent } from './tutor.ts'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'
const INDEX = fileURLToPath(new URL('../public/index.html', import.meta.url))

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 20_000) throw new Error('الطلب كبير جداً')
  }
  return body ? JSON.parse(body) : {}
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function stream(res: ServerResponse, events: (signal: AbortSignal) => AsyncGenerator<TutorEvent>) {
  const ac = new AbortController()
  res.on('close', () => ac.abort())
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for await (const event of events(ac.signal)) {
    if (ac.signal.aborted) break
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(await readFile(INDEX))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/curriculum') {
      sendJson(res, 200, { subjects: SUBJECTS, tasks: TASK_LABELS })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/task') {
      const { kind, unitId, note } = await readJson(req)
      const found = findUnit(String(unitId))
      if (!found || !Object.hasOwn(TASK_LABELS, String(kind))) {
        sendJson(res, 400, { error: 'المادة أو نوع المهمة غير صحيح' })
        return
      }
      const prompt = buildTaskPrompt(kind as TaskKind, found.subject, found.unit, typeof note === 'string' ? note : undefined)
      await stream(res, signal => ask({ prompt, systemPrompt: SYSTEM_PROMPT, signal }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/voice') {
      const { question, subjectId, sessionId } = await readJson(req)
      if (typeof question !== 'string' || !question.trim()) {
        sendJson(res, 400, { error: 'لم يصل السؤال' })
        return
      }
      const subject = typeof subjectId === 'string' && subjectId ? findSubject(subjectId) : undefined
      await stream(res, signal =>
        ask({
          prompt: buildVoicePrompt(question, subject),
          systemPrompt: VOICE_SYSTEM_PROMPT,
          resume: typeof sessionId === 'string' && sessionId ? sessionId : undefined,
          signal,
        }),
      )
      return
    }

    sendJson(res, 404, { error: 'غير موجود' })
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    else res.end()
  }
})

server.listen(PORT, HOST, () => {
  console.log(`📚 بوت الصف الثاني عشر يعمل على http://${HOST}:${PORT}`)
})
