// claude-keysmith runtime mod — register.js
//
// Closes the three wrapper-unreachable gaps on every surface that loads
// plugins (CLI, Desktop Code tab, VS Code extension, claude -p, Agent SDK):
//
//   1. prompt.compose / prompt.section — inject the keysmith envelope as a
//      system-prompt section, so IDE/ACP/-p sessions get the same prompt the
//      wrapper delivers via --system-prompt-file / --append-system-prompt-file.
//   2. turn.step + agent.spawn — pin every model request and every subagent
//      spawn to the opus 4.6 family, a runtime lock behind the settings env
//      alias locks.
//   3. tool.call on Task/Agent — prepend the envelope to every subagent
//      prompt, extending the keysmith agents carrier to ALL agent types
//      (superpowers implementers included), not just the keysmith agent.
//
// Fail-open everywhere: a thrown hook is skipped by Claude Code, so a mod
// fault degrades to normal behavior, never blocks a session.

const LOCK_MODEL = 'claude-opus-4-6';
const ENVELOPE_MARKER = '[keysmith-mod]';
const CARRIER_HEADER = '[keysmith-mod carrier] The bench envelope applies to this subagent task.';

const state = {
  envelope: null,
  envelopeBytes: 0,
  envelopeSource: null,
  sectionIds: [],
  composeInjected: false,
  rewrites: { turns: 0, spawns: 0, tasks: 0 },
};

function isLocked(model) {
  return typeof model === 'string' && model.startsWith(LOCK_MODEL);
}

async function loadEnvelope($, home) {
  const candidates = [
    { path: home + '/.claude/keysmith/system-prompt.md', label: 'system-prompt.md' },
    { path: home + '/.claude/keysmith/append-prompt.md', label: 'append-prompt.md' },
  ];
  const parts = [];
  for (const c of candidates) {
    const text = await $.fs.read(c.path);
    if (typeof text === 'string' && text.trim().length > 0) {
      parts.push(text.trim());
      state.envelopeSource = state.envelopeSource || c.label;
    }
  }
  if (parts.length > 0) {
    state.envelope = parts.join('\n\n');
    state.envelopeBytes = state.envelope.length;
    return true;
  }
  return false;
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'));
      if (home && (await loadEnvelope($, home))) {
        $.ui.status('keysmith mod: envelope ' + state.envelopeBytes + 'B ready');
      } else {
        $.ui.status('keysmith mod: no envelope files found (install keysmith first)');
      }
    } catch (_e) {
      $.ui.status('keysmith mod: envelope load failed, running without injection');
    }
    try {
      $.command.register({
        name: 'keysmith',
        description: 'keysmith envelope + lock status',
        argumentHint: '',
      });
    } catch (_e) {
      // command surface unavailable (e.g. headless) — status still via store
    }
    return next(e);
  });

  on('command.run', { command: 'keysmith' }, async (_$, _e) => {
    return {
      text: JSON.stringify(
        {
          envelopeLoaded: state.envelope !== null,
          envelopeBytes: state.envelopeBytes,
          envelopeSource: state.envelopeSource,
          composeInjected: state.composeInjected,
          sectionIdsSeen: state.sectionIds,
          rewrites: state.rewrites,
          lockModel: LOCK_MODEL,
        },
        null,
        2
      ),
    };
  });

  // System-prompt assembly: add one keysmith section, never rewrite others.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e);
    try {
      const sections = r && r.sections;
      if (state.envelope && Array.isArray(sections) &&
          !sections.some((s) => s && s.id === 'keysmith')) {
        const scope = sections.length > 0 && sections[0].scope ? sections[0].scope : undefined;
        state.composeInjected = true;
        return { sections: [...sections, { id: 'keysmith', text: ENVELOPE_MARKER + '\n' + state.envelope, scope }] };
      }
    } catch (_e) {
      // fall through with the unmodified compose result
    }
    return r;
  });

  // Discovery only: record which section ids this Claude Code version uses.
  on('prompt.section', async ($, e, next) => {
    try {
      if (e.name && !state.sectionIds.includes(e.name)) {
        state.sectionIds.push(e.name);
      }
    } catch (_e) {
      // section id unknown — nothing to record
    }
    return next(e);
  });

  // Runtime model lock: every model request pinned to the 4.6 family.
  on('turn.step', async function* (_$, e, next) {
    if (e && e.model && !isLocked(e.model)) {
      state.rewrites.turns++;
      yield* next({ ...e, model: LOCK_MODEL });
      return;
    }
    yield* next(e);
  });

  // Subagent spawn lock: answer-mode pin at spawn time.
  on('agent.spawn', async (_$, e, next) => {
    if (e && e.model && !isLocked(e.model)) {
      state.rewrites.spawns++;
      return { model: LOCK_MODEL };
    }
    return next(e);
  });

  // Envelope carrier for every Task/Agent dispatch, all agent types.
  on('tool.call', { tool: ['Task', 'Agent'] }, async (_$, e, next) => {
    try {
      if (state.envelope && typeof e.prompt === 'string' &&
          !e.prompt.includes(ENVELOPE_MARKER)) {
        state.rewrites.tasks++;
        return next({
          ...e,
          prompt: CARRIER_HEADER + '\n\n' + state.envelope + '\n\n---\n\nTask:\n' + e.prompt,
        });
      }
    } catch (_e) {
      // rewrite not possible for this dispatch shape — pass through
    }
    return next(e);
  });
}
