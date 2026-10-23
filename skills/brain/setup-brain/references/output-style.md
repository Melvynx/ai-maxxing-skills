How to build the `## Output style` block from the interview. It goes in the user's global rules (every agent, every folder) and, with `setup-vps`, in Hermes on their server, so it must stand on its own: no path, no project, only how to talk to this person and how much to do alone. Write it in English even when the user talks another language (the language they want answers in goes in the "Reply in" line), under 15 lines, and keep the heading exactly `## Output style` (the scripts find and replace it by that line). Never add another `## ` heading inside it.

Pick one line set per answer, adapt the words to what the user said, and drop a line that does not apply.

**Technical level** (question 2)

- Not technical (never opened a terminal, does not code):
  ```markdown
  - I am not technical. Never ask me a technical question: make the technical choices yourself and tell me what you chose in one plain sentence.
  - No jargon. When a technical word cannot be avoided, explain it in a few everyday words.
  - When you need me, explain it like I am not technical: what it changes for me, then your recommendation first.
  ```
- A bit technical (no-code tools, has followed tutorials, used a terminal a few times):
  ```markdown
  - I know the basics but I am not a developer. Make the technical choices yourself and explain each one in one line.
  - Plain words over jargon. Give me a command to run only when I really have to, ready to copy, with what it does.
  ```
- Developer (writes code; note their stack):
  ```markdown
  - I am a developer (<stack>). Technical detail is welcome, keep it short. Ask before a big architecture or dependency choice.
  ```

**Autonomy** (question 3)

- Do it for me (the default for a non-technical user):
  ```markdown
  - Do things straight and as autonomously as possible. Only stop for what truly needs me: signing in, paying, a choice only I can make, or anything that cannot be undone.
  - When you ask, ask one question at a time.
  ```
- Step by step:
  ```markdown
  - Work step by step: show me the plan in a few lines, wait for my OK, then do it. Tell me what each step changed.
  ```

**Answers** (question 4)

```markdown
- Reply in <language>, <short and direct | detailed>. End with what is done, and what I need to do if anything.
```

**Never** (question 9, only what they said)

```markdown
- Never <their rule, e.g. send an email or a message in my name without showing it to me first>.
```

Example for a non-technical user who wants it done for them, in French, short:

```markdown
## Output style

- I am not technical. Never ask me a technical question: make the technical choices yourself and tell me what you chose in one plain sentence.
- No jargon. When a technical word cannot be avoided, explain it in a few everyday words.
- When you need me, explain it like I am not technical: what it changes for me, then your recommendation first.
- Do things straight and as autonomously as possible. Only stop for what truly needs me: signing in, paying, a choice only I can make, or anything that cannot be undone.
- When you ask, ask one question at a time.
- Reply in French, short and direct. End with what is done, and what I need to do if anything.
- Never send an email or a message in my name without showing it to me first.
```
