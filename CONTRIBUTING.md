# Contributing to ImWeb

Thank you for your interest in contributing to ImWeb!

## Code of Conduct

Please be respectful and professional in all interactions.

## How Can I Contribute?

### Reporting Bugs
- Use the Bug Report template.
- Provide a clear reproduction case.
- Check the console for WebGL errors.

### Suggesting Enhancements
- Use the Feature Request template.
- Explain the use case for the video synthesis workflow.

### Pull Requests
1. Fork the repo and create your branch from `main`.
2. Follow the existing code style (Three.js + Vanilla JS).
3. If you add a new effect, ensure it follows the `Pipeline.js` `_pass` pattern.
4. If you add new parameters, register them in `ParameterSystem.js`.
5. Update documentation in `docs/` if applicable.
6. Ensure your changes don't break the strict 60 FPS target for the main render loop.

### AI-assisted commits

Much of ImWeb is written with AI coding tools. If one produced your change, say
which one in a trailer:

```
Co-Authored-By: Gemini 3 Pro <noreply@ai-assisted.invalid>
```

Install the hooks (`bash scripts/install-hooks.sh`) and export `AI_MODEL` in the
shell that runs the tool, and `prepare-commit-msg` appends it for you:

```bash
export AI_MODEL="DeepSeek V4"
```

Leave `AI_MODEL` unset for work you typed yourself — an unstamped commit means a
human wrote it, and that only stays true if the stamp is never applied loosely.

**Every AI trailer uses `noreply@ai-assisted.invalid`** — RFC 2606, permanently
unresolvable — and the hook rewrites any vendor address it finds to match,
including the one Claude Code writes for itself. That is deliberate. Anthropic
is the only AI vendor publishing an address GitHub resolves to an account, so
using real addresses made Claude the only model in the contributor graph while
five others that worked on this repo left no trace, producing a chart that
credited one model with 410 of 547 commits. The alternative — inventing
addresses for the other vendors — fabricates identities to move a number.

So these trailers are a record in the git history and nothing else. No model
appears in the contributor graph, which never measured contribution anyway.

## Development Setup

```bash
npm install
npm run dev
```

## Licensing

By contributing, you agree that your contributions will be licensed under the project's AGPL-3.0-or-later license.
