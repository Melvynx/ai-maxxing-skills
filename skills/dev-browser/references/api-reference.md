dev-browser API reference

Scripts run in a QuickJS sandbox, not Node.js. Top-level `await` works. Pages from `browser.getPage()` and `browser.newPage()` are full Playwright Page objects, documented at https://playwright.dev/docs/api/class-page.

Sandbox globals, the only ones available:

```text
browser                      pre-connected browser handle
console.log/info/warn/error  output to the terminal
setTimeout / clearTimeout    basic timers
saveScreenshot(buf, name)    save to ~/.dev-browser/tmp/<name>, returns the full path (await it)
writeFile(name, data)        write to ~/.dev-browser/tmp/<name>, returns the full path (await it)
readFile(name)               read ~/.dev-browser/tmp/<name> (await it)
```

Not available: `require()`, `import()`, `process`, `fs`, `path`, `os`, `fetch`, `WebSocket`, `__dirname`, `__filename`.

Browser handle:

```text
browser.getPage(nameOrId)    named page, created if new; or an existing tab by its id from listPages()
browser.newPage()            anonymous page, closed when the script ends
browser.listPages()          every tab: [{ id, url, title, name }]
browser.closePage(name)      close a named page
```

Page methods used most:

```text
Navigation   page.goto(url), page.goBack(), page.reload(), page.waitForURL("**/success")
Locators     page.getByRole(role, { name }), page.getByText(text), page.getByLabel(label),
             page.getByPlaceholder(text), page.getByTestId(id), page.locator(selector)
Actions      locator.click(), locator.fill(value), locator.press("Enter"),
             locator.check(), locator.selectOption(value), page.keyboard.type(text)
Reading      page.title(), page.url(), locator.textContent(), locator.innerText(),
             page.evaluate(() => ...) with plain JS only, page.$$eval(selector, fn)
Waiting      locator.waitFor(), page.waitForLoadState("networkidle"), page.waitForTimeout(ms)
Screenshots  page.screenshot(), page.screenshot({ fullPage: true }), locator.screenshot()
```

Page structure for the agent:

```javascript
const snap = await page.snapshotForAI();             // { full, incremental? }
console.log(snap.full);                              // read it, then target with getByRole
const next = await page.snapshotForAI({ track: "checkout" }); // after a change, only the diff
```

CLI:

```text
dev-browser --connect http://127.0.0.1:9333 <<'JS' ... JS   run against Chrome AI (always)
dev-browser --connect http://127.0.0.1:9333 run script.js   run a script file
dev-browser --headless <<'JS' ... JS                        throwaway signed-out Chromium
dev-browser status | stop                                   inspect or stop the background daemon
chrome-ai start | status | stop | url | app                 open, check, quit Chrome AI
```
