# API Reference

Reference de l'API remote exposee par `RemoteControlServer`.

## Authentification

- mode par defaut: token requis
- header supporte: `Authorization: Bearer <token>`
- bootstrap web supporte via `?token=...`
- apres bootstrap, le serveur pose un cookie `HttpOnly`

Reponses d'erreur courantes:

- `401 Unauthorized`
- `403 Origin is not allowed`
- `413 Request body exceeds ... bytes`
- `429 rate limit exceeded`

## Endpoints lecture

### `GET /`

Retourne l'UI web remote embarquee.

### `GET /health`

Retour:

```json
{ "ok": true }
```

### `GET /config`

Retourne:

- provider courant
- models
- feature flags
- tools exposes
- agents disponibles
- config process isolation
- config remote utile

### `GET /events`

Flux SSE des evenements runtime.

Types d'evenements notables:

- `agent.spawned`
- `agent.output.delta`
- `agent.completed`
- `tool.called`
- `tool.completed`
- `tool.failed`
- `coordinator.*`
- `mcp.*`
- `runtime.restored`

### `GET /state`

Retourne le snapshot runtime:

- `agentTasks`
- `taskRecords`
- `teams`
- `events`

### `GET /agents`

Retourne les `agentTasks`.

### `GET /tasks`

Retourne:

- `taskRecords`
- `agentTasks`

### `GET /teams`

Retourne les equipes connues.

### `GET /mcp/servers`

Retourne les connexions MCP actives:

- `name`
- `transport`
- `isolationProfile`
- `initialized`
- `toolCount`

### `GET /mcp/profiles`

Retourne:

- `activeProfile`
- `profiles`

Important:

- les headers MCP sensibles sont redactes
- les secrets ne reviennent pas en clair

### `GET /mcp/tools?server=<name>`

Retourne les tools publies par un serveur MCP connecte.

## Endpoints mutation

### `POST /agents/spawn`

Payload:

```json
{
  "description": "Ad hoc task",
  "prompt": "Analyse ce projet",
  "subagent_type": "general-purpose",
  "model": "sonnet",
  "run_in_background": false,
  "name": "agent-1",
  "team_name": "default",
  "mode": "default",
  "isolation": "worktree",
  "cwd": "C:\\repo"
}
```

### `POST /agents/message`

Payload:

```json
{
  "to": "agent-1",
  "message": "Continue avec un focus sur les tests"
}
```

### `POST /orchestrate`

Payload:

```json
{
  "goal": "Durcir le runtime",
  "aspects": ["remote", "mcp", "tests"],
  "teamName": "coordination",
  "verify": true
}
```

### `POST /teams`

Payload:

```json
{
  "team_name": "default",
  "description": "Equipe par defaut",
  "agent_type": "team-lead"
}
```

### `DELETE /teams/:name`

Supprime une equipe logique.

### `POST /mcp/connect`

Payload:

```json
{
  "name": "demo",
  "config": {
    "transport": "stdio",
    "command": "node",
    "args": ["dist/mcp/demoServer.js", "--stdio"],
    "cwd": "C:\\repo",
    "timeoutMs": 30000,
    "retries": 2,
    "requestsPerMinute": 120,
    "isolationProfile": "docker-stdio"
  }
}
```

Champs `config` utiles:

- `transport`: `stdio | http | sse | ws`
- `command`, `args`, `cwd` pour `stdio`
- `url` pour `http|sse|ws`
- `headers`
- `timeoutMs`
- `retries`
- `requestsPerMinute`
- `isolationProfile`

### `POST /mcp/disconnect`

Payload:

```json
{ "name": "demo" }
```

### `POST /mcp/profiles`

Deux modes:

1. Sauvegarder l'etat courant:

```json
{
  "name": "local",
  "description": "Profil local"
}
```

2. Upsert complet:

```json
{
  "name": "prod",
  "description": "Profil prod",
  "connections": [
    {
      "name": "secure-http",
      "config": {
        "transport": "http",
        "url": "https://example.com/mcp"
      }
    }
  ]
}
```

### `POST /mcp/profiles/activate`

Payload:

```json
{ "name": "local" }
```

### `POST /mcp/profiles/deactivate`

Payload:

```json
{ "name": "local" }
```

Le champ `name` peut etre omis pour desactiver le profil actif courant.

### `DELETE /mcp/profiles/:name`

Supprime un profil MCP nomme.

### `POST /mcp/call`

Payload:

```json
{
  "server": "demo",
  "tool": "uppercase",
  "input": { "value": "bonjour" }
}
```

## Limites importantes

- l'API remote est une API d'administration/runtime, pas une API publique multi-tenant
- pas de RBAC fin
- pas d'OIDC/SSO
- pas de versioning HTTP formel
