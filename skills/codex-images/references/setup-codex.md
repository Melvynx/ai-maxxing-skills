# Set up Codex

Read this when `codex --version` fails or `codex login status` does not say "Logged in". Do every step yourself and only ask the user for what needs a human (signing in to ChatGPT). Talk to them in their language, short messages, no jargon (never say "CLI" to them: say "Codex").

1. Node: run `node --version`. If it fails, run the `setup-node` skill first (local folder, or `https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/setup-node/SKILL.md`), then come back here.
2. Install Codex: `npm i -g @openai/codex`, then check `codex --version`. If the command is not found, prefix the next commands with the npm global bin folder (`export PATH="$(npm prefix -g)/bin:$PATH"`) and check that a new session finds it (`$SHELL -lic 'codex --version'`).
3. If the user has no ChatGPT account, send them to https://chatgpt.com and wait for "done". Image generation runs on their ChatGPT plan, nothing to pay on the side.
4. Sign in: run `codex login` in the background with its output in a file. It shows the ChatGPT sign-in page in the browser (if nothing shows up, give the user the link from that file). Tell them in one line: sign in with your ChatGPT account, accept, then say "done". On a server or with no browser, use `codex login --device-auth` instead and give them the link and the code from the output.
5. Prove it: `codex login status` says "Logged in", and a new session finds it too (`$SHELL -lic 'codex --version'`).

End with a short check list, a check or a cross on each line: Node, Codex installed, signed in to ChatGPT. Then go back to the `codex-images` steps.
