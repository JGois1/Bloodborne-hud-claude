import type { EngineInterface, Register } from 'claude-code'

import type { Hud } from '../types'

const EMPTY: Hud = { contextUsed: null, fiveHourUsed: null, sevenDayUsed: null, echoes: 0 }
const hudRef = { plugin: 'bloodborne-hud', key: 'hud' } as const

const W = 600
const H = 64
const SERIF = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif"
const PALE = '#ddd7cc'

let echoes = 0
let toolEvents = 0
// The last HP drawn, so the bar can show the orange "rally" where it fell.
let lastHpLeft = 100

// Diagnostics for /hud: how many times the band was asked for, and where.
let renderCount = 0
let lastSurface = 'none yet'
let lastError = 'none'

// What other band mods drew (the pet, for one): only a real element can be nested.
const DRAWABLE = ['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown', 'Svg', 'Raster', 'Image', 'Client']
const isDrawable = (node: unknown) =>
  typeof node === 'object' && node !== null && DRAWABLE.includes((node as { type?: string }).type ?? '')

const clamp = (n: number) => Math.max(0, Math.min(100, n))

// ---------------------------------------------------------------- drawings

const DEFS = `
<defs>
  <linearGradient id="hp" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#c8463d"/><stop offset="0.45" stop-color="#8e1a1a"/><stop offset="1" stop-color="#4c0a0b"/>
  </linearGradient>
  <linearGradient id="sta" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#93c870"/><stop offset="0.45" stop-color="#4f8a3a"/><stop offset="1" stop-color="#244c1a"/>
  </linearGradient>
  <linearGradient id="rally" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f2b354"/><stop offset="1" stop-color="#b0641a"/>
  </linearGradient>
  <linearGradient id="orn" gradientUnits="userSpaceOnUse" x1="440" y1="0" x2="594" y2="0">
    <stop offset="0" stop-color="${PALE}" stop-opacity="0.85"/><stop offset="0.8" stop-color="${PALE}" stop-opacity="0.6"/><stop offset="1" stop-color="${PALE}" stop-opacity="0.05"/>
  </linearGradient>
  <radialGradient id="glow">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="died" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.28" stop-color="#000" stop-opacity="0.88"/>
    <stop offset="0.72" stop-color="#000" stop-opacity="0.88"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
  </linearGradient>
</defs>`

// A thin bar like the game's: grey frame, black well, the orange rally where
// life was just lost, the gradient fill and (stamina) a pale glint at its tip.
function bar(x: number, y: number, w: number, h: number, pct: number, rallyPct: number, grad: 'hp' | 'sta'): string {
  const inner = w - 4
  const fill = (inner * clamp(pct)) / 100
  const rally = (inner * clamp(rallyPct)) / 100
  const parts = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#050404" stroke="#4d4843" stroke-width="1"/>`,
    `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" fill="none" stroke="#000" stroke-width="1"/>`,
  ]
  if (rally > fill) {
    parts.push(`<rect x="${x + 2 + fill}" y="${y + 2}" width="${rally - fill}" height="${h - 4}" fill="url(#rally)"/>`)
  }
  parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${fill}" height="${h - 4}" fill="url(#${grad})"/>`)
  parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${fill}" height="1" fill="#fff" opacity="0.2"/>`)
  // The pale glint, with a soft halo, at the tip of the fill.
  if (fill > 3) {
    const tip = x + 2 + fill
    parts.push(`<circle cx="${tip - 1}" cy="${y + h / 2}" r="${h * 0.9}" fill="url(#glow)"/>`)
    parts.push(`<rect x="${tip - 2}" y="${y + 2}" width="2" height="${h - 4}" fill="#f8f3ea" opacity="0.95"/>`)
  }
  return parts.join('')
}

// The number in the game's pale serif, right-aligned, with its drop shadow.
function num(x: number, y: number, size: number, body: string): string {
  const base = `x="${x}" y="${y}" font-family="${SERIF}" font-size="${size}" text-anchor="end"`
  return `<text ${base} dx="1" dy="1" fill="#000" opacity="0.8">${body}</text><text ${base} fill="${PALE}">${body}</text>`
}

// The thin rule under each number, with a double scroll at its left end
// (and a small curl at its right).
function ornament(y: number, curlRight: boolean): string {
  const left =
    `<path d="M446 ${y} c-3.4 0 -4.6 -2.8 -2.8 -3.9 c1.3 -0.8 2.9 0.2 2.2 1.5" fill="none" stroke="${PALE}" stroke-width="0.9" opacity="0.85"/>` +
    `<path d="M446 ${y} c-4 0 -6.5 0.4 -8 2.4 c-1 1.4 0.4 2.8 1.8 2 c1 -0.6 0.6 -1.8 -0.4 -1.6" fill="none" stroke="${PALE}" stroke-width="0.9" opacity="0.7"/>`
  const line = `<path d="M444 ${y} L594 ${y}" stroke="url(#orn)" stroke-width="1"/>`
  const right = curlRight
    ? `<path d="M586 ${y} c3 0 5 2 3.5 3.8 c-1.2 1.2 -3 0.4 -2.4 -1" fill="none" stroke="${PALE}" stroke-width="0.8" opacity="0.45"/>`
    : ''
  return left + line + right
}

// The Blood Echoes sigil, solid: a thin spike rising, two arms folding back
// into a diamond around its base, and a dot beneath.
const ECHO_ICON = (cx: number, cy: number) =>
  `<g transform="translate(${cx} ${cy})">` +
  `<path d="M0 -12 C0.9 -7 1.7 -2.5 1.7 5 L-1.7 5 C-1.7 -2.5 -0.9 -7 0 -12 Z" fill="${PALE}"/>` +
  `<path d="M-1.2 -1.5 L-6.2 2.8 L-2 6.8 M1.2 -1.5 L6.2 2.8 L2 6.8" fill="none" stroke="${PALE}" stroke-width="2.3" stroke-linejoin="miter" stroke-linecap="butt"/>` +
  `<circle cx="0" cy="10.2" r="1.9" fill="${PALE}"/></g>`

// The Insight eye, solid: a pale almond, a dark ring and a pale pupil.
const EYE_ICON = (cx: number, cy: number) =>
  `<g transform="translate(${cx} ${cy})"><path d="M-10 0 C-5.5 -6.5 5.5 -6.5 10 0 C5.5 6.5 -5.5 6.5 -10 0 Z" fill="${PALE}"/>` +
  `<circle cx="0" cy="0" r="3.9" fill="#0a0909"/><circle cx="0" cy="0" r="2.2" fill="${PALE}"/></g>`

function hudSvg(hpLeft: number, rallyLeft: number, staLeft: number | null, insightLeft: number | null, count: number, isWorking: boolean): string {
  const p: string[] = [DEFS]
  p.push(`<rect width="${W}" height="${H}" rx="4" fill="#0a0909" fill-opacity="0.62"/>`)
  // HP, long; stamina below it, shorter, as in the game.
  p.push(bar(12, 11, 380, 10, hpLeft, rallyLeft, 'hp'))
  p.push(`<text x="400" y="20" font-family="${SERIF}" font-size="10" fill="#8d877d">${Math.round(hpLeft)}%</text>`)
  if (staLeft !== null) {
    p.push(bar(12, 26, 172, 10, staLeft, staLeft, 'sta'))
    p.push(`<text x="192" y="35" font-family="${SERIF}" font-size="10" fill="#8d877d">${Math.round(staLeft)}%</text>`)
  } else {
    p.push(bar(12, 26, 172, 10, 0, 0, 'sta'))
    p.push(`<text x="192" y="35" font-family="${SERIF}" font-size="10" fill="#6c665f">—</text>`)
  }
  p.push(`<text x="12" y="55" font-family="${SERIF}" font-size="11" font-style="italic" fill="#7a736b">${isWorking ? 'The Hunt is On' : "Hunter's Dream"}</text>`)
  // Blood Echoes and Insight, bottom-right in the game.
  p.push(ECHO_ICON(452, 17))
  p.push(num(592, 25, 21, String(count)))
  p.push(ornament(31, false))
  p.push(EYE_ICON(452, 46))
  p.push(num(592, 53, 19, insightLeft === null ? '—' : `${Math.round(insightLeft)}<tspan font-size="12">%</tspan>`))
  p.push(ornament(58, true))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`
}

// YOU DIED: red serif across a black band that fades at top and bottom.
function diedSvg(): string {
  const t = `x="${W / 2}" y="${H / 2 + 12}" text-anchor="middle" font-family="${SERIF}" font-size="34" letter-spacing="7"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}` +
    `<rect width="${W}" height="${H}" fill="url(#died)"/>` +
    `<text ${t} fill="none" stroke="#4a0505" stroke-width="3" opacity="0.6">YOU DIED</text>` +
    `<text ${t} fill="#a01c1c">YOU DIED</text>` +
    `</svg>`
  )
}

// ----------------------------------------------------------------- engine

// Reads context, the 5h / weekly limits and the tool uses; keeps them for the
// band and mirrors them on the status line (a fallback if the band is not drawn).
async function refresh($: EngineInterface) {
  try {
    const u = await $.session.usage()
    const five = u.rateLimits.find(r => r.kind === 'five_hour')
    const week = u.rateLimits.find(r => r.kind === 'seven_day')
    // Blood Echoes = tool uses in this conversation, counted from the
    // transcript itself (it does not depend on an event having fired).
    const rows = await $.session.messages()
    echoes = rows.reduce((sum, row) => sum + row.toolUses.length, 0)
    const next: Hud = {
      contextUsed: u.context.percent ?? null,
      fiveHourUsed: five ? five.percentUsed : null,
      sevenDayUsed: week ? week.percentUsed : null,
      echoes,
    }
    await $.state.set(hudRef, next)

    const hp = next.contextUsed === null ? '--' : `${Math.round(100 - next.contextUsed)}%`
    const sta = next.fiveHourUsed === null ? '--' : `${Math.round(100 - next.fiveHourUsed)}%`
    $.ui.status(`HP ${hp} · STA ${sta} · Blood Echoes ${echoes}`)
  } catch (err) {
    lastError = String(err)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Bloodborne HUD: show its state and diagnostics',
    })
    echoes = 0
    toolEvents = 0
    lastHpLeft = 100
    await $.state.set(hudRef, EMPTY)
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    await refresh($)
    const s = ((await $.state.get(hudRef)).value ?? EMPTY) as Hud
    return {
      text: [
        'bloodborne-hud is alive.',
        `HP (context left): ${s.contextUsed === null ? '?' : Math.round(100 - s.contextUsed)}%`,
        `STA (5h left): ${s.fiveHourUsed === null ? '?' : Math.round(100 - s.fiveHourUsed)}% | Insight (weekly used): ${s.sevenDayUsed === null ? '?' : Math.round(s.sevenDayUsed)}%`,
        `Blood Echoes (tool uses in this conversation): ${s.echoes} | tool.call events seen: ${toolEvents}`,
        `band asked for: ${renderCount} times, last surface: ${lastSurface}`,
        `last error: ${lastError}`,
      ].join('\n'),
    }
  })

  on('tool.call', async ($, e, next) => {
    toolEvents += 1
    const result = await next(e)
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    renderCount += 1
    lastSurface = String(e.surface)
    if (e.props.hasSurvey) {
      return next(e)
    }

    // Keep whatever the mods below drew (the pet); ours goes above it.
    const below = await next(e)
    const others = isDrawable(below) ? below : null

    const s = ((await $.state.get(hudRef)).value ?? EMPTY) as Hud
    const { Box, Svg } = $.ui.resolve(e)

    const hpLeft = s.contextUsed === null ? 100 : clamp(100 - s.contextUsed)
    const staLeft = s.fiveHourUsed === null ? null : clamp(100 - s.fiveHourUsed)
    const insightLeft = s.sevenDayUsed === null ? null : Math.min(99, clamp(s.sevenDayUsed)) // insight grows as the weekly limit is spent (like madness in the game)

    const rally = Math.max(hpLeft, lastHpLeft)
    lastHpLeft = hpLeft

    const isDead = hpLeft <= 5
    const source = isDead ? diedSvg() : hudSvg(hpLeft, rally, staLeft, insightLeft, s.echoes, e.props.isWorking)
    const alt = isDead
      ? 'You died: the context is nearly full'
      : `HP ${Math.round(hpLeft)}%, stamina ${staLeft === null ? 'unknown' : Math.round(staLeft) + '%'}, ${s.echoes} Blood Echoes, insight ${insightLeft === null ? 'unknown' : Math.round(insightLeft) + '%'}`

    return (
      <Box flexDirection="column" width="100%">
        <Box width="100%" justifyContent="center">
          <Svg source={source} alt={alt} width={W} height={H} />
        </Box>
        {others}
      </Box>
    )
  })
}
