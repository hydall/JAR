# Janitor AI Ripper

JAR (Janitor AI Ripper) — extract lorebooks and characters from JanitorAI, both public and private, locally on your PC and automated.

## Setup

**Windows:** double-click **`start.bat`**. The first run installs Node.js, dependencies,
and Chromium, then starts the app. Subsequent runs just launch.

**Manual:**
```bash
npm install
cp .env.example .env
npm start                   # opens http://localhost:4577
```

The app uses a **separate browser** (`user-data/` folder) — you log into JanitorAI once
inside it and the session persists. All extraction happens **under your account**;
the tool sends the character text as chat messages to trigger lorebook entries.
**A throwaway account is recommended.**

The program does not collect or store your login credentials — it only reads the
JanitorAI session cookie to verify you are signed in.

Open **⚙ Settings** to configure the extraction LLM — any OpenAI-compatible endpoint
(OpenRouter, OpenAI, local) that will be used to build the lorebook JSON.

## Use

1. **Log in** — click the **🔓** button in the header. A separate browser window opens at
   janitorai.com/login. Sign in as usual. The app detects the session automatically.

2. **Inspect a character** — paste the character URL into the sidebar and click
   **extract**. This pulls the card, avatar, and any public lorebooks.

3. **Extract a private card** — if the character definition is hidden, click
   **extract card** in the *character card* tab. The tool creates a chat, sends a probe,
   captures the card from the sent request.

4. **Extract a closed lorebook** — click **extract** in the *lorebook* tab. Sends the selected context to trigger lorebook entries on Janitor servers. Then, those entries are intercepted. Click "build lorebook" and select context to send these entries to an LLM of choice to reconstruct a lorebook. 

5. **Download** — click **download .json** for a SillyTavern World Info file. Import via
   World Info → Import. Character cards download as PNG or JSON from the *character card*
   tab.


## How it works

JanitorAI uses Cloudflare to protect against automation. JAR launches a **full browser
window** that passes through Cloudflare and executes all requests from there.

**Private Character card extraction** — JAR creates a dummy proxy preset, sends a message in
the chat, and intercepts the `generateAlpha` response: the assembled prompt that contains
the character card wrapped in tags.

**Private lorebook extraction** — closed lorebooks are processed on the JanitorAI server.
Fully extracting them in their original form is impossible. As a workaround, JAR sends
the character card, its catalog description, and the first message into the chat. This
text reaches the JanitorAI server, where it triggers lorebook entries. The server injects
those entries into the prompt. JAR intercepts the `generateAlpha` response and isolates
the lorebook entries, discarding everything else.


**Public lorebooks and characters** — These are public and are downloaded directly from /hampter/characters endpoint.
When a character has both public and closed lorebooks, the public entry text is
automatically subtracted from the captured prompt before extraction, leaving only the
closed entries.

After extraction you can:
- Download a **raw lorebook** without keys or rules.
- Send the entries to a chosen LLM (along with the selected context) and have it build a proper lorebook.

If the character uses a generic lorebook (e.g. a universe or shared lorebook), this
method may not trigger all entries automatically. The only way to pull them is to
manually type the trigger keys during entry collection. Those keys can then be sent to
the LLM during the build for additional context.

License: AGPL-3.0
