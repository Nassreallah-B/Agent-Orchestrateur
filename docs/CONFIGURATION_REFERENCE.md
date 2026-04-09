# Configuration Reference

Reference concise de la configuration du blueprint.

## RuntimeOptions

Principaux champs:

- `models.defaultMain`
- `models.defaultSubagent`
- `models.aliases`
- `featureFlags`
- `persistenceDir`
- `maxToolRounds`
- `provider`
- `security`
- `logging`

## Provider LLM

Selection:

- `--mock`
- `--huggingface`
- ou auto si `HF_TOKEN`, `HF_BASE_URL` ou `OPENAI_BASE_URL` existent

Variables d'environnement utiles:

- `HF_TOKEN`
- `HF_BASE_URL`
- `HF_MODEL`
- `HF_TIMEOUT_MS`
- `HF_MAX_RETRIES`
- `HF_RETRY_BASE_DELAY_MS`
- `HF_RETRY_MAX_DELAY_MS`
- `HF_REQUESTS_PER_MINUTE`
- `HF_MAX_CONCURRENCY`
- `HF_ENABLE_THINKING`
- `HF_MAX_TOKENS`
- `HF_TEMPERATURE`
- `HF_TOP_P`
- `HF_TOP_K`
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

## Security

### `security.shell`

- `enabled`
- `allowedCommands`
- `blockedPatterns`
- `maxTimeoutMs`
- `maxStdoutBytes`
- `maxStderrBytes`
- `sanitizeEnv`

### `security.filesystem`

- `allowedRoots`
- `denyPathPatterns`
- `maxReadBytes`
- `maxWriteBytes`

### `security.remote`

- `requireToken`
- `allowQueryTokenBootstrap`
- `maxBodyBytes`
- `requestsPerMinute`
- `mutationRequestsPerMinute`
- `trustedOrigins`
- `sessionTtlMs`

### `security.llm`

- `timeoutMs`
- `maxRetries`
- `baseDelayMs`
- `maxDelayMs`
- `requestsPerMinute`
- `concurrency`

### `security.mcp`

- `timeoutMs`
- `maxRetries`
- `baseDelayMs`
- `maxDelayMs`
- `requestsPerMinute`
- `concurrency`
- `allowedTransports`

### `security.processIsolation`

- `detectedProviders`
- `defaultShellProfile`
- `defaultMcpProfile`
- `profiles`

### `security.quotas`

- `maxStoredTasks`
- `maxConcurrentTasks`
- `maxTeams`

### `security.redactKeys`

Liste de patterns supplementaires consideres sensibles.

## Logging

### `logging.level`

Valeurs:

- `debug`
- `info`
- `warn`
- `error`

### `logging.console`

Active/desactive la sortie console.

### `logging.filePath`

Fichier JSONL principal runtime.

### `logging.auditFilePath`

Fichier JSONL d'audit.

## Profils d'isolation

Un profil de process isolation peut contenir:

- `name`
- `provider`
- `image`
- `network`
- `workspaceMountPath`
- `workspaceReadOnly`
- `extraArgs`
- `commandMap`
- `hostFallback`
- `envAllowList`

## CLI par defaut

La CLI cree une config raisonnable dans [cli.ts](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/src/cli.ts).

Valeurs notables:

- `persistenceDir = .agent-blueprint-state`
- quotas par defaut
- logs dans `.agent-blueprint-state/logs`
- remote token requis
- detection auto des providers d'isolation

## Limites

- la configuration est code-first aujourd'hui
- pas encore de fichier `config.toml` ou `config.yaml`
- pas encore de rechargement dynamique
