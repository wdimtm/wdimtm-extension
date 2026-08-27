# Product modes: Moment + Page chat

WDIMTM is one extension with two surfaces.

## Moment (primary)

```text
select → bubble + Lens → short explain popover
```

Use when: “What does this mean to me?” — fast, in-flow, no prompt writing.

### Lens selection (optional smart default)

| Mode | Behavior |
|------|----------|
| **Automatic** (default) | Suggest a lens from selection + profile (zero extra network). Bubble shows `Auto · Engineering` etc. User may pin any explicit lens for the session. |
| **Manual** | Always use the configured default lens. Bubble lists only real lenses (no Auto). |

Never hide the lens control — automatic is a default, not a lock.

## Page chat (secondary escalation)

```text
popover → 「深入对话 / Discuss further」 → right chat drawer
```

Use when: the short answer is not enough and the user wants back-and-forth.

### Rules

- Chat is **opt-in**, never the default homepage of the product.
- Same **Lens / memory / runtime / privacy bounds** as explain.
- Session is **page-scoped** (origin + pathname), not a global chatbot.
- Still **never** upload the full DOM.

### Origin

Absorbs the useful idea from the early `anypage-chat` prototype (page assistant sidebar) without replacing WDIMTM’s core differentiator.
