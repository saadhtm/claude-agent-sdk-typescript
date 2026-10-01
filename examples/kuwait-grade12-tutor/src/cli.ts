/**
 * أداة سطر الأوامر لإعداد الأوراق وحفظها كملفات Markdown في مجلد output/.
 *
 * أمثلة:
 *   npm run cli -- list
 *   npm run cli -- explain physics-1
 *   npm run cli -- daily chemistry-2 "ركّز على حسابات pH"
 *   npm run cli -- week 1 5 علمي        ← مراجعات ومذكرات واختبارات الأسبوع 5 لكل مواد القسم العلمي
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { SUBJECTS, findUnit, unitForWeek, type Subject } from './curriculum.ts'
import { SYSTEM_PROMPT, TASK_LABELS, buildTaskPrompt, type TaskKind } from './prompts.ts'
import { ask } from './tutor.ts'

const OUT_DIR = 'output'

async function generate(kind: TaskKind, unitId: string, note?: string): Promise<string> {
  const found = findUnit(unitId)
  if (!found) throw new Error(`وحدة غير معروفة: ${unitId} (شغّل: npm run cli -- list)`)
  const { subject, unit } = found

  console.error(`\n⏳ ${TASK_LABELS[kind]} — ${subject.name} / ${unit.title}`)
  let out = ''
  for await (const e of ask({ prompt: buildTaskPrompt(kind, subject, unit, note), systemPrompt: SYSTEM_PROMPT })) {
    if (e.type === 'text') {
      out += e.text
      process.stdout.write(e.text)
    } else if (e.type === 'error') {
      throw new Error(e.message)
    }
  }

  await mkdir(OUT_DIR, { recursive: true })
  const file = `${OUT_DIR}/${kind}-${unit.id}-${new Date().toISOString().slice(0, 10)}.md`
  await writeFile(file, `# ${TASK_LABELS[kind]}: ${subject.name} — ${unit.title}\n\n${out.trim()}\n`)
  console.error(`\n✅ حُفظ في ${file}`)
  return file
}

const [cmd, ...args] = process.argv.slice(2)

if (!cmd || cmd === 'list') {
  for (const s of SUBJECTS) {
    console.log(`\n${s.name} [${s.track}]`)
    for (const u of s.units) console.log(`  ${u.id.padEnd(14)} ف${u.term}  ${u.title}`)
  }
} else if (cmd === 'week') {
  const term = Number(args[0]) === 2 ? 2 : 1
  const week = Number(args[1] ?? 1)
  const track = args[2]
  const subjects = SUBJECTS.filter((s: Subject) => !track || s.track === track || s.track === 'مشترك')
  for (const s of subjects) {
    const unit = unitForWeek(s, term, week)
    await generate('weekly-notes', unit.id)
    await generate('weekly-test', unit.id)
  }
} else if (Object.hasOwn(TASK_LABELS, cmd)) {
  if (!args[0]) throw new Error('حدد معرّف الوحدة، مثل: physics-1')
  await generate(cmd as TaskKind, args[0], args[1])
} else {
  console.error(`أمر غير معروف: ${cmd}. الأوامر: list, explain, daily, weekly-notes, weekly-test, week`)
  process.exit(1)
}
