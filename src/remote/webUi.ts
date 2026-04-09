export function renderRemoteControlHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Blueprint Control</title>
  <style>
    :root {
      --bg: #12100e;
      --panel: #1f1a16;
      --panel-alt: #2a231d;
      --line: rgba(255, 242, 230, 0.12);
      --text: #f5eadc;
      --muted: #c7b49a;
      --accent: #ff9d42;
      --accent-2: #ffd166;
      --good: #7bd389;
      --bad: #ff6b6b;
      --warn: #ffbe0b;
      --shadow: 0 20px 70px rgba(0,0,0,.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(255,157,66,.16), transparent 35%),
        radial-gradient(circle at top right, rgba(255,209,102,.12), transparent 30%),
        linear-gradient(180deg, #171310, #0e0c0a 70%);
      min-height: 100vh;
    }
    header {
      padding: 28px 24px 18px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,0));
      position: sticky;
      top: 0;
      backdrop-filter: blur(18px);
      z-index: 5;
    }
    h1, h2 {
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-weight: 600;
      letter-spacing: .02em;
      margin: 0;
    }
    h1 { font-size: 34px; }
    h2 { font-size: 20px; margin-bottom: 14px; }
    p { color: var(--muted); margin: 8px 0 0; }
    .wrap {
      width: min(1480px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.2fr .9fr;
      gap: 18px;
      padding: 18px 0 28px;
    }
    .column {
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .panel {
      background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel .body { padding: 18px; }
    .cards {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-top: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
    }
    .card .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .1em;
    }
    .card .value {
      font-size: 28px;
      margin-top: 10px;
      font-weight: 700;
    }
    .toolbar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    button, input, textarea, select {
      font: inherit;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #181410;
      color: var(--text);
    }
    button {
      padding: 10px 14px;
      cursor: pointer;
      background: linear-gradient(180deg, #ffae5d, #ff8f2f);
      color: #1a120b;
      font-weight: 700;
      border: none;
    }
    button.secondary {
      background: var(--panel-alt);
      color: var(--text);
      border: 1px solid var(--line);
    }
    input, textarea, select {
      width: 100%;
      padding: 11px 12px;
    }
    textarea {
      min-height: 92px;
      resize: vertical;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .full { grid-column: 1 / -1; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px 8px;
      border-top: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .08em;
      font-size: 11px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.06);
    }
    .status.good { color: var(--good); }
    .status.bad { color: var(--bad); }
    .status.warn { color: var(--warn); }
    .stack {
      display: grid;
      gap: 10px;
    }
    .event-list {
      max-height: 360px;
      overflow: auto;
      display: grid;
      gap: 10px;
    }
    .event {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: rgba(255,255,255,.02);
    }
    .event .meta {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: #ffe7c8;
    }
    .pill {
      display: inline-block;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(255,157,66,.12);
      color: var(--accent-2);
      border: 1px solid rgba(255,157,66,.15);
      font-size: 12px;
    }
    @media (max-width: 1080px) {
      .grid { grid-template-columns: 1fr; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .form-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Agent Blueprint Control</h1>
      <p>Remote console for agents, orchestration, MCP servers, live events, and session state.</p>
      <div class="toolbar">
        <span id="provider-pill" class="pill">provider: loading</span>
        <span id="health-pill" class="pill">health: checking</span>
        <button id="refresh" class="secondary">Refresh</button>
      </div>
      <div class="cards">
        <div class="card"><div class="label">Agents</div><div id="agents-count" class="value">0</div></div>
        <div class="card"><div class="label">Running</div><div id="running-count" class="value">0</div></div>
        <div class="card"><div class="label">Task Records</div><div id="task-record-count" class="value">0</div></div>
        <div class="card"><div class="label">Teams</div><div id="teams-count" class="value">0</div></div>
        <div class="card"><div class="label">MCP Servers</div><div id="mcp-count" class="value">0</div></div>
      </div>
    </div>
  </header>
  <main class="wrap grid">
    <section class="column">
      <div class="panel"><div class="body">
        <h2>Actions</h2>
        <form id="spawn-form" class="form-grid">
          <input name="agentType" placeholder="general-purpose" value="general-purpose" />
          <input name="description" placeholder="Description" value="Ad hoc task" />
          <input name="name" placeholder="Optional name" />
          <select name="background">
            <option value="false">Run foreground</option>
            <option value="true">Run background</option>
          </select>
          <textarea class="full" name="prompt" placeholder="Prompt"></textarea>
          <button class="full" type="submit">Spawn Agent</button>
        </form>
        <div style="height:14px"></div>
        <form id="message-form" class="form-grid">
          <input name="target" placeholder="Agent id or name" />
          <textarea class="full" name="message" placeholder="Follow-up message"></textarea>
          <button class="full" type="submit">Send Message</button>
        </form>
        <div style="height:14px"></div>
        <form id="orchestrate-form" class="form-grid">
          <input class="full" name="goal" placeholder="Goal" />
          <input class="full" name="aspects" placeholder="architecture | tests | mcp" />
          <button class="full" type="submit">Run Coordinator Workflow</button>
        </form>
      </div></div>
      <div class="panel"><div class="body">
        <h2>Agents</h2>
        <div style="overflow:auto"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Description</th><th>Result</th></tr></thead><tbody id="agents-table"></tbody></table></div>
      </div></div>
      <div class="panel"><div class="body">
        <h2>Tasks And Teams</h2>
        <div class="stack">
          <div><strong>Workflow</strong><div id="workflow-status"></div></div>
          <div><strong>Task Records</strong><div id="task-records"></div></div>
          <div><strong>Teams</strong><div id="teams"></div></div>
        </div>
      </div></div>
    </section>
    <aside class="column">
      <div class="panel"><div class="body">
        <h2>MCP</h2>
        <form id="mcp-connect-form" class="form-grid">
          <input name="name" placeholder="server name" />
          <select name="transport">
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
            <option value="ws">ws</option>
          </select>
          <input class="full" name="command" placeholder="command or empty for non-stdio" />
          <input class="full" name="args" placeholder="args, separated by ||" />
          <input class="full" name="cwd" placeholder="cwd for stdio servers (default: workspace)" />
          <input class="full" name="url" placeholder="url for http/sse/ws" />
          <input class="full" name="isolationProfile" placeholder="isolation profile, ex: docker-stdio" />
          <button class="full" type="submit">Connect MCP Server</button>
        </form>
        <div style="height:14px"></div>
        <form id="mcp-call-form" class="form-grid">
          <input name="server" placeholder="server" />
          <input name="tool" placeholder="tool" />
          <textarea class="full" name="input" placeholder='{"value":"bonjour"}'></textarea>
          <button class="full" type="submit">Call MCP Tool</button>
        </form>
        <div style="height:14px"></div>
        <form id="mcp-profile-form" class="form-grid">
          <input name="name" placeholder="profile name" />
          <input name="description" placeholder="description" />
          <button class="full" type="submit">Save Current As Profile</button>
        </form>
        <div style="height:14px"></div>
        <div id="mcp-profiles"></div>
        <div style="height:14px"></div>
        <div id="mcp-servers"></div>
      </div></div>
      <div class="panel"><div class="body">
        <h2>Live Events</h2>
        <div id="events" class="event-list"></div>
      </div></div>
      <div class="panel"><div class="body">
        <h2>Response</h2>
        <pre id="response-output">No action yet.</pre>
      </div></div>
    </aside>
  </main>
  <script>
    const state = {
      token: new URLSearchParams(window.location.search).get('token') || '',
      events: [],
      agents: [],
      liveOutputs: {},
      workflow: [],
      profiles: [],
      activeProfile: null
    };
    if (state.token) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('token');
      window.history.replaceState({}, document.title, cleanUrl.toString());
      state.token = '';
    }

    function authHeaders() {
      return state.token ? { Authorization: 'Bearer ' + state.token } : {};
    }

    async function api(path, options) {
      const opts = Object.assign({ headers: {}, credentials: 'same-origin' }, options || {});
      opts.headers = Object.assign({}, opts.headers, authHeaders());
      const response = await fetch(path, opts);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || ('HTTP ' + response.status));
      }
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response.json();
      return response.text();
    }

    function setResponse(value) {
      document.getElementById('response-output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    function recordWorkflow(message) {
      state.workflow.push({
        at: new Date().toLocaleTimeString(),
        message: message
      });
      state.workflow = state.workflow.slice(-12);
      renderWorkflow();
    }

    function upsertAgentOutput(taskId, output) {
      if (!taskId) return;
      state.liveOutputs[taskId] = output;
      state.agents = state.agents.map(function(agent) {
        if (agent.id !== taskId) return agent;
        return Object.assign({}, agent, { output: output });
      });
    }

    function badge(status) {
      const normalized = String(status || 'unknown');
      const tone = /completed|ok|healthy/i.test(normalized) ? 'good' : /fail|error|stopped/i.test(normalized) ? 'bad' : 'warn';
      return '<span class="status ' + tone + '">' + normalized + '</span>';
    }

    function renderAgents(agents) {
      const rows = agents.slice().reverse().map(function(agent) {
        const liveOutput = state.liveOutputs[agent.id];
        const displayOutput = liveOutput !== undefined ? liveOutput : (agent.result || agent.output || '');
        return '<tr>' +
          '<td>' + (agent.name || agent.agentId) + '</td>' +
          '<td>' + agent.agentType + '</td>' +
          '<td>' + badge(agent.status) + '</td>' +
          '<td>' + (agent.description || '') + '</td>' +
          '<td><pre>' + (displayOutput.slice(0, 240) || '') + '</pre></td>' +
        '</tr>';
      }).join('');
      document.getElementById('agents-table').innerHTML = rows || '<tr><td colspan="5">No agents yet.</td></tr>';
    }

    function renderTaskRecords(taskRecords) {
      const html = taskRecords.map(function(task) {
        return '<div class="event"><div class="meta">' + task.id + ' · ' + task.status + '</div><div><strong>' + task.subject + '</strong></div><div>' + task.description + '</div></div>';
      }).join('');
      document.getElementById('task-records').innerHTML = html || '<p>No task records.</p>';
    }

    function renderTeams(teams) {
      const html = teams.map(function(team) {
        const members = team.members.map(function(member) { return member.name + ' (' + (member.agentType || 'n/a') + ')'; }).join(', ');
        return '<div class="event"><div class="meta">' + team.name + '</div><div><strong>' + (team.description || 'No description') + '</strong></div><div>' + members + '</div></div>';
      }).join('');
      document.getElementById('teams').innerHTML = html || '<p>No teams.</p>';
    }

    function renderWorkflow() {
      const html = state.workflow.slice().reverse().map(function(entry) {
        return '<div class="event"><div class="meta">' + entry.at + '</div><div>' + entry.message + '</div></div>';
      }).join('');
      document.getElementById('workflow-status').innerHTML = html || '<p>No workflow activity yet.</p>';
    }

    function renderEvents() {
      const html = state.events.slice(-40).reverse().map(function(event) {
        return '<div class="event"><div class="meta">' + new Date(event.timestamp).toLocaleString() + ' · ' + event.type + '</div><pre>' + JSON.stringify(event.payload || {}, null, 2) + '</pre></div>';
      }).join('');
      document.getElementById('events').innerHTML = html || '<p>No events yet.</p>';
    }

    function renderMcpServers(servers) {
      const html = servers.map(function(server) {
        return '<div class="event"><div class="meta">' + server.name + ' · ' + server.transport + '</div><div>initialized=' + server.initialized + ' · tools=' + server.toolCount + (server.isolationProfile ? ' · isolation=' + server.isolationProfile : '') + '</div><div style="margin-top:10px"><button class="secondary" onclick="disconnectMcpServer(' + JSON.stringify(server.name) + ')">Disconnect</button></div></div>';
      }).join('');
      document.getElementById('mcp-servers').innerHTML = html || '<p>No MCP servers connected.</p>';
    }

    function renderMcpProfiles() {
      const html = state.profiles.map(function(profile) {
        const isActive = state.activeProfile === profile.name;
        return '<div class="event">' +
          '<div class="meta">' + profile.name + (isActive ? ' · active' : '') + '</div>' +
          '<div><strong>' + (profile.description || 'No description') + '</strong></div>' +
          '<div>connections=' + (profile.connections ? profile.connections.length : 0) + '</div>' +
          '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">' +
            '<button class="secondary" onclick="activateMcpProfile(' + JSON.stringify(profile.name) + ')">Activate</button>' +
            '<button class="secondary" onclick="deactivateMcpProfile(' + JSON.stringify(profile.name) + ')">Deactivate</button>' +
            '<button class="secondary" onclick="deleteMcpProfile(' + JSON.stringify(profile.name) + ')">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
      const deactivateCurrent = state.activeProfile
        ? '<div style="margin-bottom:10px"><button class="secondary" onclick="deactivateMcpProfile()">Deactivate Current Profile</button></div>'
        : '';
      document.getElementById('mcp-profiles').innerHTML =
        deactivateCurrent + (html || '<p>No MCP profiles saved.</p>');
    }

    async function disconnectMcpServer(name) {
      const result = await api('/mcp/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      setResponse(result);
      recordWorkflow('Disconnected MCP server ' + name);
      await refresh();
    }

    window.disconnectMcpServer = disconnectMcpServer;

    async function activateMcpProfile(name) {
      const result = await api('/mcp/profiles/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      setResponse(result);
      await refresh();
    }

    async function deactivateMcpProfile(name) {
      const result = await api('/mcp/profiles/deactivate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name || undefined })
      });
      setResponse(result);
      await refresh();
    }

    async function deleteMcpProfile(name) {
      const result = await api('/mcp/profiles/' + encodeURIComponent(name), {
        method: 'DELETE'
      });
      setResponse(result);
      await refresh();
    }

    window.activateMcpProfile = activateMcpProfile;
    window.deactivateMcpProfile = deactivateMcpProfile;
    window.deleteMcpProfile = deleteMcpProfile;

    async function refresh() {
      const [config, health, snapshot, mcpServers, mcpProfiles] = await Promise.all([
        api('/config'),
        api('/health'),
        api('/state'),
        api('/mcp/servers'),
        api('/mcp/profiles')
      ]);

      document.getElementById('provider-pill').textContent = 'provider: ' + (config.provider && config.provider.name ? config.provider.name : 'unknown') + ' · model: ' + (config.provider && config.provider.model ? config.provider.model : config.models.defaultMain);
      document.getElementById('health-pill').textContent = 'health: ' + (health.ok ? 'ok' : 'down');
      document.getElementById('agents-count').textContent = String(snapshot.agentTasks.length);
      document.getElementById('running-count').textContent = String(snapshot.agentTasks.filter(function(task) { return ['running', 'in_progress', 'pending'].includes(task.status); }).length);
      document.getElementById('task-record-count').textContent = String(snapshot.taskRecords.length);
      document.getElementById('teams-count').textContent = String(snapshot.teams.length);
      document.getElementById('mcp-count').textContent = String(mcpServers.length);
      state.agents = snapshot.agentTasks;
      state.profiles = mcpProfiles.profiles || [];
      state.activeProfile = mcpProfiles.activeProfile || null;
      renderAgents(state.agents);
      renderTaskRecords(snapshot.taskRecords);
      renderTeams(snapshot.teams);
      renderMcpProfiles();
      renderMcpServers(mcpServers);
    }

    function connectEvents() {
      const source = new EventSource('/events');
      source.onmessage = function(event) {
        const parsed = JSON.parse(event.data);
        state.events.push(parsed);
        if (parsed.type === 'agent.output.delta') {
          upsertAgentOutput(parsed.payload && parsed.payload.taskId, parsed.payload && parsed.payload.output || '');
          renderAgents(state.agents);
          setResponse(parsed.payload && parsed.payload.output || '');
        }
        if (parsed.type === 'tool.called') {
          const tool = parsed.payload && parsed.payload.tool || 'unknown';
          recordWorkflow('Tool started: ' + tool);
          setResponse(parsed.payload && parsed.payload.inputPreview || ('Tool started: ' + tool));
        }
        if (parsed.type === 'tool.completed') {
          const tool = parsed.payload && parsed.payload.tool || 'unknown';
          recordWorkflow('Tool completed: ' + tool);
          setResponse(parsed.payload && parsed.payload.resultPreview || ('Tool completed: ' + tool));
        }
        if (parsed.type === 'tool.failed') {
          const tool = parsed.payload && parsed.payload.tool || 'unknown';
          recordWorkflow('Tool failed: ' + tool);
          setResponse(parsed.payload && parsed.payload.resultPreview || parsed.payload && parsed.payload.error || ('Tool failed: ' + tool));
        }
        if (String(parsed.type || '').startsWith('coordinator.')) {
          recordWorkflow(parsed.type + ' ' + JSON.stringify(parsed.payload || {}));
        }
        if (String(parsed.type || '').startsWith('mcp.')) {
          recordWorkflow(parsed.type + ' ' + JSON.stringify(parsed.payload || {}));
        }
        renderEvents();
      };
      source.onerror = function() {
        document.getElementById('health-pill').textContent = 'health: event stream reconnecting';
      };
    }

    document.getElementById('refresh').addEventListener('click', function() {
      refresh().then(function() { setResponse('Refreshed.'); }).catch(function(error) { setResponse(String(error)); });
    });

    document.getElementById('spawn-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const payload = {
        subagent_type: form.get('agentType'),
        description: form.get('description'),
        prompt: form.get('prompt'),
        name: form.get('name') || undefined,
        run_in_background: form.get('background') === 'true'
      };
      const result = await api('/agents/spawn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      setResponse(result);
      await refresh();
    });

    document.getElementById('message-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const result = await api('/agents/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: form.get('target'), message: form.get('message') }) });
      setResponse(result);
      await refresh();
    });

    document.getElementById('orchestrate-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const payload = {
        goal: form.get('goal'),
        aspects: String(form.get('aspects') || '').split('|').map(function(part) { return part.trim(); }).filter(Boolean),
        teamName: 'coordination',
        verify: true
      };
      const result = await api('/orchestrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      setResponse(result);
      await refresh();
    });

    document.getElementById('mcp-connect-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const transport = String(form.get('transport'));
      const payload = {
        name: form.get('name'),
        config: {
          transport: transport,
          command: form.get('command') || undefined,
          args: String(form.get('args') || '').split('||').map(function(value) { return value.trim(); }).filter(Boolean),
          cwd: form.get('cwd') || undefined,
          url: form.get('url') || undefined,
          isolationProfile: form.get('isolationProfile') || undefined
        }
      };
      const result = await api('/mcp/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      setResponse(result);
      await refresh();
    });

    document.getElementById('mcp-call-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const rawInput = String(form.get('input') || '{}');
      const result = await api('/mcp/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ server: form.get('server'), tool: form.get('tool'), input: JSON.parse(rawInput) }) });
      setResponse(result);
      await refresh();
    });

    document.getElementById('mcp-profile-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const form = new FormData(event.target);
      const result = await api('/mcp/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description') || undefined
        })
      });
      setResponse(result);
      await refresh();
    });

    connectEvents();
    refresh().catch(function(error) { setResponse(String(error)); });
    setInterval(function() { refresh().catch(function() {}); }, 5000);
  </script>
</body>
</html>`
}
