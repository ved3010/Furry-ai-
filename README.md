# Cattuu / Furry personal agent

The desktop cat includes a compact black-and-white assistant for chat, memories,
tasks, reminders, Unstop shortcuts, music search, and approved desktop actions.

## Run it

```bash
npm install
npm start
```

Click `✦` to open chat; `×` or Escape collapses it back into a button. Responses
remain in the scrollable panel when reopened. `Cmd/Ctrl+K` opens chat while the
cat window has keyboard focus. Open `⚙` to configure:

- **API base URL** — Gemini works with
  `https://generativelanguage.googleapis.com/v1beta/openai/`; local endpoints
  such as `http://127.0.0.1:11434/v1` also work
- **Model** — a model available through your provider/account. Existing choices
  are preserved; the app does not silently change providers or models.
- **API key** — stored through Electron safe storage when available

Open **⚙ → Check API connection** after saving or selecting a provider. The
check sends a tiny real chat-completion request without adding anything to
conversation history. For Gemini, it first makes a bounded 10-second authenticated
model lookup to distinguish key/model/network failures from generation failures.
The lookup alone **never** reports Connected; actual text generation must succeed.
Both phases share a 55-second total budget. The UI never displays or logs the key
itself. A blank secret field saying **Saved key — leave blank to keep it** means
the existing key will be reused, not erased.

Provider requests use Electron's Chromium networking (`net.fetch`), including
system proxy/PAC settings, rather than Node's separate HTTP stack. Cookies and
cached authentication checks are disabled. TLS verification remains enabled;
proxy, DNS, and certificate failures include only safe error identifiers, never
raw URLs or credentials. No automatic fallback silently bypasses your proxy.

Gemini requests use the native Interactions API rather than relying on the
OpenAI-compatible compatibility layer. This keeps the configured system
instructions and conversation context intact while using Gemini's low-thinking
mode for faster replies. The connection check and chat use the same 55-second
provider deadline. Settings shows elapsed time while checking, and allows an
additional 10 seconds for the backend to return its result. A provider timeout
does **not** establish whether a key is valid or billing is enabled; an
unresponsive desktop backend is reported separately with restart instructions.

If Gemini reports an authentication error, use an authorization key or restrict
the key to the Gemini API in Google Cloud/AI Studio, then save it again. A key
being present in secure storage does not guarantee that the provider still
accepts it.

If the connection check passes but a normal question reports billing or quota,
the Google project attached to the key must have Gemini inference access. The
key itself cannot enable billing; resolve the project status in Google AI
Studio/Cloud Billing and run the connection check again.

Local endpoints on `localhost` and `127.0.0.1` do not require an API key.
Environment variables are also supported: `AGENT_BASE_URL`, `AGENT_MODEL`,
`AGENT_API_KEY`, or `GEMINI_API_KEY`.

## What the cat can do

- Answer questions and keep the conversation history locally.
- Understand natural-language follow-ups using the recent conversation,
  relevant memories, local tasks, and the user's local date/time zone.
- Remember facts when asked, create tasks, and list or complete open tasks.
- Propose reminders; the existing reminder system is only changed after you
  click **Allow**.
- Open an HTTPS URL, a local file, or any installed macOS app by name without
  asking for the same Allow confirmation each time. If the app name is not
  installed, the cat reports that clearly instead of retrying.
- Run only a small platform-specific allowlist of commands, with approval.
- Remember an **Always allow** decision for the exact normalized action (or all
  controls for the approved desktop player), so the same music control,
  reminder, or command does not ask again after restarting. **Allow once**
  remains available for one-off actions, and saved permissions can be forgotten
  from ⚙.
- Open public Unstop opportunity pages in your browser, using your own browser
  login. This is **not** an authenticated Unstop account/API connection.
- Search for songs on Spotify, YouTube, YouTube Music, or Apple Music.
- Control desktop Spotify or Music on macOS after approval.

The legacy native voice listener is Windows-only. It is disabled on macOS;
these assistant features use typed commands there. No screen reading, arbitrary
file access, autonomous applications/purchases, or unrestricted computer control
is enabled.

The agent data is stored in Electron's user-data directory under `agent/`, not
in the repository. The UI uses a narrow Electron IPC bridge. Its fallback RPC
bridge is loopback-only and protected by a per-launch capability token.

## Fast commands

These common commands bypass model latency and work even during a provider outage:

| Try typing | Result |
| --- | --- |
| `help` | Show capabilities and commands |
| `open Unstop` | Open Unstop immediately |
| `find hackathons on Unstop` | Open the public hackathon listing immediately |
| `find AI internships on Unstop` | Propose a Google site search of Unstop |
| `open Unstop SmartHire` | Launch SmartHire if installed |
| `play Yellow on Spotify` | Propose opening Spotify search results |
| `play Yellow on YouTube Music` | Propose opening YouTube Music search results |
| `play Yellow on Apple Music` | Propose opening Apple Music search results |
| `pause music on Spotify` | Propose pausing the desktop player |
| `resume music on Apple Music` | Propose resuming Music |
| `next song on Spotify` | Propose advancing the desktop player |
| `what is playing on Spotify` | Propose reading the player's current track |
| `play <Spotify track URL>` | Propose playing that specific track in desktop Spotify |
| `list tasks` / `list reminders` | Show locally stored items |
| `add task: Finish project` | Store a task locally |
| `remember project: AI cat` | Store an explicit key/value memory |

Opening apps, links, and local paths is a fast local action and does not wait
for the model or ask for repeated approval. Song-name commands **open search
results**, not automatic playback. Choose the
matching result in your music service. Actual desktop controls and Spotify
track-link playback require the player to be installed, open, signed in, and
able to play the content. macOS may request Automation permission; the user
must grant it. The cat reports the observed player state, not guaranteed audible
playback. No account tokens are collected for these shortcuts.

## Request recovery

The model request uses a compact context window. Gemini uses low thinking and
a 4,096-token generation cap, shared by reasoning and answer text, rather than
the old 256-token connection-check cap. Other providers use a 256-token check
and a 1,200-token chat cap. Both provider paths use a 55-second total request
budget, including response-body reads. There is at most one bounded
transient-error retry, respecting short `Retry-After` delays. Incomplete Gemini
generations are failures, not successful connection checks. Timeouts, invalid
models, authentication failures, empty responses, and quota errors have
actionable messages rather than raw `AbortError` text. Timed-out requests are
not automatically duplicated. Your failed prompt stays available with a
**Retry** button. Provider outages still prevent general AI answers; the local
shortcuts remain available.

## Checks

```sh
npm test
COMNYANG_AGENT_PORT=0 npm start -- --comnyang-smoke-test
```

`npm test` runs dependency-free, offline Node tests for request deadlines,
retries, prompt recovery, shortcut parsing, approval validation, and mocked
native playback. It does not access personal state or music accounts.

An isolated Electron check verifies the actual settings button and natural-language
reply display against a local mock of Gemini, including a real 21-second reply
that exceeds the former timeout limits. It also reproduces the networking bug
with a proxy-only provider: Node fetch fails, while the production backend succeeds
using Chromium's session proxy:

```sh
./node_modules/.bin/electron tests/electron-connection-smoke.cjs
# In a root Linux container without a display:
xvfb-run -a ./node_modules/.bin/electron tests/electron-connection-smoke.cjs --no-sandbox
```

This check creates and removes a temporary profile, never loads your saved key,
and blocks real provider requests by default. Add `--live-network` to also contact
Google's model-lookup and Interactions endpoints with a deliberately invalid dummy
key, asserting a prompt authentication failure rather than a network timeout.
This confirms reachability only, not your account's generation access.
It loads the agent, not the legacy pet hooks;
unregistered legacy pet-settings IPC and missing Linux audio/DBus warnings may
appear but do not indicate failure of this isolated agent check.

Optional live-window check: start a single cat instance with
`npm start -- --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`,
then run `node tests/electron-smoke.cjs`. Add `--live-model` to send a neutral
test question through the configured provider. The check does not approve
external actions. Quit that debug instance and relaunch normally afterward;
do not leave debugging enabled.
