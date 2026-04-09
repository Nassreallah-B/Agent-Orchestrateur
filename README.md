# Blueprint pour recreer un systeme d'agents similaire

Ce dossier fournit un plan et un squelette TypeScript pour reconstruire, dans ta propre IA, un systeme d'agents proche de celui observe dans ce snapshot.

## Documentation map

Documentation principale:

- [README.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/README.md)
- [AGENTS_EXPLICATIONS.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/AGENTS_EXPLICATIONS.md)

Documentation d'exploitation:

- [DOCUMENTATION_CHECKLIST.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/DOCUMENTATION_CHECKLIST.md)
- [API_REFERENCE.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/API_REFERENCE.md)
- [CONFIGURATION_REFERENCE.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/CONFIGURATION_REFERENCE.md)
- [PERSISTENCE_AND_STATE.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/PERSISTENCE_AND_STATE.md)
- [OPERATIONS_RUNBOOK.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/OPERATIONS_RUNBOOK.md)
- [SECURITY_MODEL.md](C:/Serveurs/Claude%20Code%20Source/agent_blueprint/docs/SECURITY_MODEL.md)

Important :

- ce blueprint vise une compatibilite architecturale et fonctionnelle
- il ne pretend pas reproduire a l'identique tout le produit original
- certains comportements reels dependent de code absent ici, de feature gates, de services externes, de l'UI, de l'analytics, du remote control et du MCP runtime

En pratique, ce blueprint te donne :

1. les memes categories d'agents
2. les memes champs de definition d'agent
3. les memes schemas de parameters pour les tools principaux
4. un runtime minimal pour lancer, reprendre et piloter des agents
5. un systeme de taches et d'equipes en memoire

## Ce qui est reconstruit

- `AgentDefinition` avec champs proches du snapshot
- `BuiltInAgentDefinition`, `CustomAgentDefinition`, `PluginAgentDefinition`
- `AgentTool` avec :
  - `description`
  - `prompt`
  - `subagent_type`
  - `model`
  - `run_in_background`
  - `name`
  - `team_name`
  - `mode`
  - `isolation`
  - `cwd`
- `SendMessageTool`
- `TaskCreate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`, `TaskUpdate`
- `TeamCreate`, `TeamDelete`
- agents built-in :
  - `general-purpose`
  - `Explore`
  - `Plan`
  - `verification`
  - `claude-code-guide`
  - `statusline-setup`
- roles speciaux :
  - `fork`
  - `team-lead`
  - `worker`

## Ce qui n'est pas clone a 1:1

- UI terminal / REPL
- systeme complet de permissions du produit original
- analytics / growthbook / feature gates reelles
- MCP runtime complet
- mode remote / bridge
- persistance disque complete du produit original
- implementation concrete du `worker` du coordinator mode, absente dans ce snapshot

## Arborescence du blueprint

```text
agent_blueprint/
  README.md
  src/
    builtins.ts
    index.ts
    loaders.ts
    runtime.ts
    types.ts
    tools/
      agentTool.ts
      sendMessageTool.ts
      taskTools.ts
      teamTools.ts
```

## Dependances conseillees

Le code ci-dessous part du principe que tu utilises :

- TypeScript
- `zod` pour les schemas d'entree / sortie
- un client LLM a toi
- un registry de tools maison

Installation minimale suggeree :

```bash
npm install zod
```

## Ordre de mise en place

### Etape 1. Definir le modele de donnees

Commence par `src/types.ts`.

Tu y poses :

- les types d'agents
- les types de taches
- les types d'equipes
- le contrat des tools
- le contexte runtime

### Etape 2. Definir les agents built-in

Ensuite `src/builtins.ts`.

Tu recrees :

- leurs noms
- leur role
- leurs outils autorises
- leurs restrictions
- leur system prompt

### Etape 3. Charger et resoudre les agents

Ensuite `src/loaders.ts`.

Tu fusionnes :

- built-ins
- custom
- plugin

Tu appliques aussi une logique de precedence :

1. built-in
2. plugin
3. user / project / policy selon ta politique

### Etape 4. Implementer le runtime d'agents

Ensuite `src/runtime.ts`.

Le runtime doit savoir :

- lister les agents
- lancer un agent
- reprendre un agent
- envoyer un message a un agent
- stocker les taches
- gerer les equipes

### Etape 5. Exposer les tools

Dans `src/tools/`, tu implementes :

- `AgentTool`
- `SendMessageTool`
- `Task*`
- `Team*`

### Etape 6. Brancher ton LLM

Le runtime ci-dessous suppose une abstraction :

- `invokeModel(messages, tools, model)`

Cette fonction est a brancher sur ton IA.

### Etape 7. Ajouter les extensions

Si tu veux aller plus loin :

- agents markdown
- plugin agents
- memoire persistante
- hooks
- MCP
- worktree isolation

## Schema de compatibilite des tools

### AgentTool

Entree compatible :

```ts
{
  description: string;
  prompt: string;
  subagent_type?: string;
  model?: "sonnet" | "opus" | "haiku";
  run_in_background?: boolean;
  name?: string;
  team_name?: string;
  mode?: "default" | "plan" | "acceptEdits" | "dontAsk" | "bubble";
  isolation?: "worktree" | "remote";
  cwd?: string;
}
```

### SendMessageTool

Entree compatible :

```ts
{
  to: string;
  summary?: string;
  message:
    | string
    | {
        type: "shutdown_request";
        reason?: string;
      }
    | {
        type: "shutdown_response";
        request_id: string;
        approve: boolean | "true" | "false";
        reason?: string;
      }
    | {
        type: "plan_approval_response";
        request_id: string;
        approve: boolean | "true" | "false";
        feedback?: string;
      };
}
```

### TaskCreate

```ts
{
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}
```

### TaskGet

```ts
{
  taskId: string;
}
```

### TaskList

```ts
{}
```

### TaskOutput

```ts
{
  task_id: string;
  block?: boolean;
  timeout?: number;
}
```

### TaskStop

```ts
{
  task_id?: string;
  shell_id?: string;
}
```

### TaskUpdate

```ts
{
  taskId: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "deleted";
  addBlocks?: string[];
  addBlockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
}
```

### TeamCreate

```ts
{
  team_name: string;
  description?: string;
  agent_type?: string;
}
```

### TeamDelete

```ts
{}
```

## Strategie de reproduction

Si tu veux "les memes agents" dans ton IA, procede comme suit :

1. garde les memes `agentType`
2. garde les memes champs de definition d'agent
3. garde les memes schemas de tools
4. garde les memes restrictions de haut niveau
5. adapte seulement :
   - ton backend LLM
   - tes outils locaux
   - ton stockage
   - ton auth / permissions

## Recommandation d'implementation

Ne cherche pas a copier le produit original bit-a-bit.

Ce qu'il faut reproduire, c'est :

1. le contrat des agents
2. la logique de selection
3. la boucle spawn -> execution -> resultat -> reprise
4. les taches de fond
5. la coordination d'equipe

Le squelette TypeScript dans `src/` est fait pour ca.

## Version executable

Le blueprint est maintenant prepare comme mini-projet executable.

### Fichiers ajoutes

- `package.json`
- `tsconfig.json`
- `src/featureFlags.ts`
- `src/analytics/*`
- `src/coordinator/workerAgent.ts`
- `src/coordinator/coordinatorRuntime.ts`
- `src/mcp/*`
- `src/persistence/*`
- `src/ui/*`
- `src/mockModel.ts`
- `src/cli.ts`

### Lancer la demo

```bash
cd agent_blueprint
npm install
npm run dev
```

### Scripts utiles

```bash
npm run dev
npm run dev:mock
npm run dev:hf
```

### Commandes dans la REPL

- `agents`
- `spawn <agentType> <description> :: <prompt>`
- `message <agentIdOrName> :: <message>`
- `tasks`
- `teams`
- `quit`

### Exemple

```text
spawn general-purpose test rapide :: Analyse ce projet et resume les points critiques
message mon-agent :: continue avec un focus sur les tests
```

## Upgrades ajoutes

Le blueprint couvre maintenant aussi :

- event bus runtime
- snapshot de session complet
- remote control HTTP + SSE
- coordinator workflow avance
- MCP stdio reel avec framing `Content-Length`
- transports MCP HTTP, SSE, WS utilisables cote client
- serveur MCP de demo pour test local
- dashboard REPL plus riche

### Nouvelles commandes REPL

- `dashboard`
- `events [limit]`
- `orchestrate <goal> :: <aspect1> | <aspect2> | <aspect3>`
- `mcp demo [name]`
- `mcp servers`
- `mcp tools <server>`
- `mcp call <server> <tool> :: <json>`
- `remote start [port] [token]`
- `remote stop`
- `save [dir]`
- `load [dir]`
- `mcp profile list`
- `mcp profile save <name> :: <description>`
- `mcp profile activate <name>`
- `mcp profile deactivate [name]`
- `mcp profile delete <name>`

### Remote control

Une fois `remote start 8787` lance dans la REPL :

- `GET /health`
- `GET /state`
- `GET /events`
- `GET /agents`
- `GET /tasks`
- `GET /teams`
- `POST /agents/spawn`
- `POST /agents/message`
- `POST /teams`
- `DELETE /teams/:name`
- `GET /mcp/servers`
- `POST /mcp/connect`
- `POST /mcp/disconnect`
- `GET /mcp/tools?server=name`
- `POST /mcp/call`

### MCP de demo

```bash
npm run mcp:demo
```

Ou directement depuis la REPL :

```text
mcp demo
mcp servers
mcp tools demo
mcp call demo time :: {}
mcp call demo uppercase :: {"value":"bonjour"}
```

## LLM reel : Hugging Face Qwen

Le blueprint sait maintenant utiliser un endpoint OpenAI-compatible pour `Qwen/Qwen3.5-397B-A17B`.

### Provider par defaut

Si `HF_TOKEN`, `HF_BASE_URL` ou `OPENAI_BASE_URL` est defini, la CLI utilise le provider Hugging Face au lieu du mock.

### Variables d'environnement utiles

```bash
HF_TOKEN=hf_xxx
HF_MODEL=Qwen/Qwen3.5-397B-A17B
HF_BASE_URL=https://router.huggingface.co/v1
HF_MAX_TOKENS=4096
HF_TIMEOUT_MS=120000
HF_ENABLE_THINKING=true
```

### Endpoint local compatible OpenAI

Le provider supporte aussi un serveur local compatible OpenAI, par exemple celui recommande par la model card Qwen via `vLLM`, `SGLang` ou `transformers serve`.

Exemple local :

```bash
OPENAI_BASE_URL=http://localhost:8000/v1
OPENAI_API_KEY=EMPTY
HF_MODEL=Qwen/Qwen3.5-397B-A17B
```

## Persistance MCP

Les connexions MCP sont maintenant sauvegardees automatiquement dans :

```text
<persistenceDir>/mcp-connections.json
```

Au demarrage de la CLI, le blueprint tente de restaurer automatiquement ces connexions.

### Gestion manuelle

Dans la REPL :

```text
mcp demo
mcp servers
mcp disconnect demo
```

Dans l'UI web :

- chaque serveur MCP a un bouton `Disconnect`
- la route `POST /mcp/disconnect` est exposee

## Profils MCP nommes

Le blueprint gere maintenant des profils MCP persistants, par exemple :

- `local`
- `dev`
- `prod`

Un profil contient :

- un nom
- une description optionnelle
- la liste des connexions MCP a activer

### Fichier de persistance

```text
<persistenceDir>/mcp-profiles.json
```

### API remote

- `GET /mcp/profiles`
- `POST /mcp/profiles`
- `POST /mcp/profiles/activate`
- `POST /mcp/profiles/deactivate`
- `DELETE /mcp/profiles/:name`

### REPL

```text
mcp profile list
mcp profile save local :: Profile local de demo
mcp profile activate local
mcp profile deactivate
mcp profile delete local
```

## Boucle agentique outillee

Le runtime ne fait plus seulement un aller-retour texte.

Il gere maintenant :

1. `assistant -> tool_call`
2. execution du tool
3. injection du `tool_result`
4. nouvel appel modele
5. reponse finale ou nouveaux appels outils

### Tools locaux fournis

- `Agent`
- `SendMessage`
- `TaskCreate`
- `TaskGet`
- `TaskList`
- `TaskOutput`
- `TaskStop`
- `TaskUpdate`
- `TeamCreate`
- `TeamDelete`
- `Read`
- `Write`
- `Edit`
- `ListFiles`
- `Search`
- `Shell`
- `WebFetch`
- `WebSearch`
- `McpListServers`
- `McpListTools`
- `McpCallTool`

## UI web remote

Le serveur remote sert maintenant une UI web embarquee.

Depuis la REPL :

```text
remote start 8787 secret
```

Puis ouvre :

```text
http://localhost:8787/?token=secret
```

L'UI permet :

- voir les agents, taches, equipes et evenements
- lancer un agent
- envoyer un message a un agent
- lancer une orchestration coordinator
- voir la config provider/model
- connecter et appeler des serveurs MCP

## Streaming live

Le provider Hugging Face sait maintenant utiliser le streaming SSE du routeur OpenAI-compatible.

### Effet dans le runtime

- emission d'evenements `agent.output.delta`
- mise a jour live de `task.output`
- affichage progressif dans la REPL
- mise a jour immediate dans l'UI web via `/events`

### Remarque Qwen

Sur `Qwen/Qwen3.5-397B-A17B`, le routeur Hugging Face peut encore produire une longue phase de `reasoning` avant le texte visible final. Le streaming visible fonctionne, mais la sortie utilisateur peut n'apparaitre qu'apres cette phase.

## Tools MCP dynamiques

Les tools MCP generiques ne sont plus presentes dans la surface agentique.

A la place, chaque serveur MCP connecte injecte automatiquement ses tools sous des noms derives de :

```text
mcp_<server>_<tool>
```

Exemple avec le serveur de demo `demo` :

- `mcp_demo_echo`
- `mcp_demo_time`
- `mcp_demo_uppercase`

### Effet pratique

- le modele voit directement les vrais tools MCP disponibles
- pas besoin d'un proxy `McpCallTool`
- les descriptions et schemas d'entree de chaque tool MCP sont propagés au modele

## Workflow live dans l'UI

L'UI web affiche maintenant aussi :

- les deltas de sortie agent en direct
- le lancement et la completion des tools avec preview du resultat
- les etapes du coordinator :
  - `coordinator.started`
  - `coordinator.workers.spawned`
  - `coordinator.workers.completed`
  - `coordinator.synthesis.started`
  - `coordinator.synthesis.completed`
  - `coordinator.verification.started`
  - `coordinator.verification.completed`
  - `coordinator.completed`

## Persistance de l'historique runtime

Le snapshot de session inclut maintenant aussi l'historique des evenements runtime.

Concretement, apres redemarrage :

- les evenements recents sont restaures
- le panneau workflow peut se reconstruire
- les etats coordinator/MCP recents restent visibles

Le fichier reste :

```text
<persistenceDir>/session.json
```

## Durcissement production

Le blueprint inclut maintenant une premiere couche de durcissement transversale.

### Remote control

- auth par token active par defaut
- cookie de session `HttpOnly` pose lors du bootstrap web
- token retire de l'URL apres chargement de l'UI
- body size limitee
- rate limits lecture / mutation
- validation stricte des payloads JSON
- headers HTTP de securite
- redaction des secrets MCP dans les reponses d'administration

### Tools locaux

- `Read`, `Write`, `Edit`, `ListFiles`, `Search`, `Shell` bornes aux `allowedRoots`
- tailles max de lecture / ecriture
- blocage de patterns shell dangereux
- environnement shell nettoye par defaut
- isolation OS configurable pour `Shell`

### LLM et MCP

- timeout explicite
- retries avec backoff
- rate limiting
- limite de concurrence
- retries coupes sur streaming deja entame pour eviter les sorties dupliquees
- isolation OS configurable pour les serveurs `MCP stdio`

## Isolation OS

Le blueprint sait maintenant encapsuler l'execution de `Shell` et des serveurs `MCP stdio`
dans un profil d'isolation.

### Providers supportes

- `docker`
- `firejail`
- `bubblewrap`
- `none`

### Activation par defaut

La CLI detecte automatiquement les providers utilisables au demarrage.

- si `docker` est installe et que son daemon est joignable, `docker-shell` et `docker-stdio` sont actives par defaut
- sinon, les profils restent disponibles dans la config mais ne sont pas actives automatiquement

### Exemple de configuration

```ts
security: {
  processIsolation: {
    detectedProviders: { docker: true },
    defaultShellProfile: 'docker-shell',
    defaultMcpProfile: 'docker-stdio',
    profiles: {
      'docker-shell': {
        name: 'docker-shell',
        provider: 'docker',
        image: 'node:22-alpine',
        network: 'none',
        workspaceMountPath: '/workspace',
        workspaceReadOnly: false,
      },
      'docker-stdio': {
        name: 'docker-stdio',
        provider: 'docker',
        image: 'node:22-alpine',
        network: 'none',
        workspaceMountPath: '/workspace',
        workspaceReadOnly: false,
        hostFallback: 'warn',
      }
    }
  }
}
```

### Notes importantes

- pour `Shell`, l'isolation Docker est directe et robuste
- pour `MCP stdio`, l'isolation Docker remappe automatiquement les runtimes courants (`node`, `python`, `bash`, `sh`)
- un binaire exotique non mappable peut retomber sur l'hote si le profil l'autorise via `hostFallback: 'warn' | 'allow'`
- si tu veux un comportement strict, utilise `hostFallback: 'error'`

### Persistance

- ecriture JSON atomique
- lock simple par fichier
- sauvegarde structuree de :
  - `session.json`
  - `mcp-connections.json`
  - `mcp-profiles.json`

## Logs et audit

Le runtime ecrit maintenant des logs structures JSONL.

Par defaut dans la CLI :

```text
.agent-blueprint-state/logs/runtime.log
.agent-blueprint-state/logs/audit.log
```

Le fichier `runtime.log` contient :

- evenements analytics structures
- erreurs runtime / remote
- traces operatoires utiles

Le fichier `audit.log` contient :

- demarrage / arret remote
- actions sensibles remote
- connexions / deconnexions MCP
- sauvegardes / chargements de session

## Configuration de securite

Les garde-fous sont exposes via `RuntimeOptions.security` :

```ts
security: {
  shell: {
    enabled: true,
    allowedCommands?: string[],
    blockedPatterns?: string[],
    maxTimeoutMs?: number,
  },
  filesystem: {
    allowedRoots?: string[],
    denyPathPatterns?: string[],
    maxReadBytes?: number,
    maxWriteBytes?: number,
  },
  remote: {
    requireToken?: boolean,
    allowQueryTokenBootstrap?: boolean,
    maxBodyBytes?: number,
    requestsPerMinute?: number,
    mutationRequestsPerMinute?: number,
    trustedOrigins?: string[],
    sessionTtlMs?: number,
  },
  llm: {
    timeoutMs?: number,
    maxRetries?: number,
    baseDelayMs?: number,
    maxDelayMs?: number,
    requestsPerMinute?: number,
    concurrency?: number,
  },
  mcp: {
    timeoutMs?: number,
    maxRetries?: number,
    baseDelayMs?: number,
    maxDelayMs?: number,
    requestsPerMinute?: number,
    concurrency?: number,
    allowedTransports?: Array<"stdio" | "http" | "sse" | "ws">,
  },
  quotas: {
    maxStoredTasks?: number,
    maxConcurrentTasks?: number,
    maxTeams?: number,
  },
}
```

## Tests automatises

Les tests couvrent maintenant :

- restrictions filesystem et shell
- auth remote, limite de body, redaction des secrets
- retry Hugging Face sur erreur transitoire
- persistance session + profils MCP + historique d'evenements
- planification d'isolation Docker pour `Shell` et `MCP stdio`

Commande :

```bash
npm run build
npm test
```
