# Agents de `Claude Code Source`

Ce document resume les types d'agents visibles dans ce snapshot du depot, leur role, leur mode d'activation, et les nuances importantes entre agents reels, agents synthetiques, et points d'extension dynamiques.

## Vue d'ensemble

Le systeme d'agents est centre sur `tools/AgentTool`. La liste finale des agents est composee dans `tools/AgentTool/loadAgentsDir.ts` a partir de trois sources :

1. `built-in` : agents integres au produit
2. `plugin` : agents fournis par des plugins
3. `custom` : agents definis par l'utilisateur ou par le projet

Dans ce snapshot precis :

- les agents `built-in` sont bien presents dans le code
- les agents `plugin` sont supportes par l'architecture mais aucun n'est present localement
- les agents `custom` sont supportes par l'architecture mais aucun n'est present localement

## Comment les agents sont charges

Fichiers importants :

- `tools/AgentTool/loadAgentsDir.ts`
- `tools/AgentTool/builtInAgents.ts`
- `utils/plugins/loadPluginAgents.ts`

Le flux est le suivant :

1. `getBuiltInAgents()` retourne les agents integres
2. `loadPluginAgents()` ajoute les agents fournis par les plugins actifs
3. le loader cherche aussi des agents custom en Markdown ou JSON
4. l'ensemble est fusionne dans `allAgents`
5. une version `activeAgents` est calculee a partir de cette liste

## Categories d'agents visibles dans ce depot

Il y a trois categories utiles a distinguer :

1. agents built-in reels
2. agents synthetiques ou roles reserves
3. agents dynamiques supportes, mais absents dans ce snapshot

## 1. Agents built-in reels

Ce sont les agents clairement definis dans `tools/AgentTool/built-in`.

### 1. `general-purpose`

- Fichier : `tools/AgentTool/built-in/generalPurposeAgent.ts`
- Type : agent built-in standard
- Role : agent polyvalent pour la recherche dans le code, l'analyse multi-fichiers, et les taches en plusieurs etapes
- Outils : `['*']`
- Usage typique : quand il faut chercher dans une grande base de code, comprendre l'architecture, ou executer une tache complexe sans specialisation plus precise
- Remarque : c'est l'agent de base le plus general

### 2. `Explore`

- Fichier : `tools/AgentTool/built-in/exploreAgent.ts`
- Type : agent built-in standard
- Role : agent de recherche rapide dans le code
- Nature : lecture seule
- Outils interdits : edition, ecriture, notebook edit, spawn d'autres agents
- Usage typique : retrouver des fichiers, des motifs, des points d'entree, des usages d'API, ou repondre a une question sur le code sans rien modifier
- Remarque : il est explicitement concu pour etre rapide et read-only

### 3. `Plan`

- Fichier : `tools/AgentTool/built-in/planAgent.ts`
- Type : agent built-in standard
- Role : agent d'architecture et de planification
- Nature : lecture seule
- Outils : alignes sur ceux de `Explore`
- Usage typique : produire une strategie d'implementation, decrire les etapes, identifier les fichiers critiques, et exposer les compromis
- Remarque : il planifie, mais ne modifie pas le projet

### 4. `verification`

- Fichier : `tools/AgentTool/built-in/verificationAgent.ts`
- Type : agent built-in standard
- Role : agent de verification agressive
- Nature : il doit tester, essayer de casser, et rendre un verdict
- Sortie attendue : `VERDICT: PASS`, `VERDICT: FAIL`, ou `VERDICT: PARTIAL`
- Usage typique : verifier une implementation non triviale, lancer builds, tests, linters, verifier regressions et cas limites
- Remarque : il est explicitement configure pour ne pas modifier les fichiers du projet

### 5. `claude-code-guide`

- Fichier : `tools/AgentTool/built-in/claudeCodeGuideAgent.ts`
- Type : agent built-in standard
- Role : agent de documentation et d'assistance sur Claude Code, le Claude Agent SDK, et la Claude API
- Outils : lecture locale + fetch/search web
- Usage typique : repondre a des questions du type "comment faire", "est-ce que Claude Code sait", "comment configurer hooks / MCP / skills / settings"
- Remarque : il privilegie les sources officielles

### 6. `statusline-setup`

- Fichier : `tools/AgentTool/built-in/statuslineSetup.ts`
- Type : agent built-in standard
- Role : configurer la `statusLine` dans les settings utilisateur de Claude Code
- Outils : `Read`, `Edit`
- Usage typique : convertir une configuration de prompt shell en status line Claude Code, ou modifier cette status line
- Remarque : c'est un agent tres specialise

## Conditions d'activation des built-ins

Tous les built-ins ne sont pas forcement actifs en meme temps.

### `general-purpose`

- present dans la liste standard

### `statusline-setup`

- present dans la liste standard

### `Explore`

- ajoute seulement si `areExplorePlanAgentsEnabled()` retourne vrai
- cela depend d'un feature gate

### `Plan`

- ajoute seulement si `areExplorePlanAgentsEnabled()` retourne vrai
- il est lie au meme gate que `Explore`

### `claude-code-guide`

- ajoute pour les entrypoints non SDK
- il peut etre exclu pour certains usages SDK

### `verification`

- ajoute seulement si le feature gate `VERIFICATION_AGENT` et la valeur experimentale associee sont actives

## 2. Agents synthetiques ou roles reserves

Ces elements existent dans le systeme, mais ils ne fonctionnent pas tous comme des built-ins classiques de la liste standard.

### 7. `fork`

- Fichier : `tools/AgentTool/forkSubagent.ts`
- Type : agent synthetique
- Role : sous-agent implicite qui herite du contexte complet du parent
- Activation : quand `subagent_type` est omis et que le mode `fork subagent` est actif
- Remarque importante : `fork` n'est pas enregistre dans `getBuiltInAgents()`

Autrement dit :

- il existe bien comme type d'agent
- il est reel dans le flux d'execution
- mais ce n'est pas un built-in standard selectable dans la liste normale

### 8. `team-lead`

- Fichier principal : `utils/swarm/constants.ts`
- Utilisation : `tools/TeamCreateTool/TeamCreateTool.ts`
- Type : role reserve pour le mode equipe / swarm
- Role : identite du chef d'equipe dans un groupe multi-agents
- Usage typique : coordination d'un ensemble de coequipiers et gestion de l'etat d'equipe

Remarque importante :

- `team-lead` n'est pas defini comme un built-in classique dans `tools/AgentTool/built-in`
- c'est un role structurel du systeme swarm

### 9. `worker`

- Fichier de reference : `coordinator/coordinatorMode.ts`
- Type : role reserve pour le mode coordinator
- Role : agent executeur lance par le coordinateur pour faire de la recherche, de l'implementation, ou de la verification
- Usage typique : le coordinateur spawn un ou plusieurs `worker` avec `subagent_type: "worker"`

Remarque critique :

- `worker` est clairement reference et utilise dans le code du mode coordinator
- `builtInAgents.ts` essaye de charger `../../coordinator/workerAgent.js` si le coordinator mode est actif
- ce fichier `workerAgent.js` n'est pas present dans ce snapshot

Conclusion :

- `worker` est un type reserve visible et exploite par la logique du produit
- mais son implementation complete n'est pas incluse dans ce snapshot local

## 3. Agents dynamiques supportes, mais absents ici

Le systeme peut charger d'autres agents qui ne sont pas hardcodes dans `built-in`.

### Agents custom

Ils peuvent venir de :

- fichiers Markdown avec frontmatter
- definitions JSON
- configuration utilisateur ou projet

Le parseur supporte notamment :

- `name`
- `description`
- `tools`
- `disallowedTools`
- `skills`
- `initialPrompt`
- `mcpServers`
- `hooks`
- `model`
- `effort`
- `permissionMode`
- `maxTurns`
- `memory`
- `background`
- `isolation`

Dans ce snapshot :

- aucun agent custom n'a ete trouve dans le depot

### Agents plugin

Les plugins peuvent fournir un dossier `agents/` et injecter leurs propres types d'agents dans le systeme.

Caracteristiques :

- nom final prefixe par le nom du plugin
- source marquee comme `plugin`
- prompts et frontmatter dedies

Dans ce snapshot :

- le chargement des plugin agents est supporte
- mais aucun plugin local de ce depot ne fournit d'agent exploitable

## Ce qu'il y a dans le dossier `tools/`

Le dossier `tools/` ne contient pas uniquement des agents.

Il contient surtout :

1. le moteur des agents
2. les outils qui pilotent les agents
3. les outils generaux du produit

La confusion vient du fait que plusieurs sous-dossiers de `tools/` servent a faire vivre le systeme multi-agents, sans etre eux-memes des "agents" au sens strict.

## `tools/AgentTool` : le coeur du systeme d'agents

Le sous-dossier `tools/AgentTool` est l'endroit central pour les agents.

### Fichiers principaux

#### `tools/AgentTool/AgentTool.tsx`

- C'est le point d'entree du tool `Agent`
- Il sert a lancer un agent specialise
- Il choisit le type d'agent a utiliser
- Il applique les permissions et prepare le contexte

Remarque :

- le tool s'appelle `Agent`
- il a aussi un alias legacy `Task`

#### `tools/AgentTool/constants.ts`

- Definit les noms importants du systeme d'agents
- On y trouve notamment :
  - le nom du tool `Agent`
  - l'alias legacy `Task`
  - le type `verification`

#### `tools/AgentTool/builtInAgents.ts`

- Construit la liste des agents built-in
- Decide quels built-ins sont actifs selon les feature gates et le mode d'execution

#### `tools/AgentTool/loadAgentsDir.ts`

- Charge et fusionne toutes les definitions d'agents
- Sources gerees :
  - built-in
  - plugin
  - custom
- C'est le fichier le plus important pour comprendre le chargement global des agents

#### `tools/AgentTool/runAgent.ts`

- Lance concretement l'execution d'un agent
- Gere son contexte, ses tools, son isolation, ses hooks, et ses MCP eventuels

#### `tools/AgentTool/resumeAgent.ts`

- Reprend un agent deja lance
- Sert a restaurer le bon type d'agent et son contexte lors d'une reprise

#### `tools/AgentTool/forkSubagent.ts`

- Gere le mode `fork`
- Permet de lancer un sous-agent qui herite du contexte complet du parent

#### `tools/AgentTool/prompt.ts`

- Contient le texte qui explique au modele principal comment utiliser le tool `Agent`
- Donne les regles de choix d'un `subagent_type`

### Fichiers de support

#### `tools/AgentTool/agentMemory.ts`

- Gere la memoire par type d'agent

#### `tools/AgentTool/agentMemorySnapshot.ts`

- Gere les snapshots de memoire des agents

#### `tools/AgentTool/agentDisplay.ts`

- Gere l'affichage et le regroupement des agents pour l'UI

#### `tools/AgentTool/UI.tsx`

- Gere le rendu UI associe aux agents

#### `tools/AgentTool/agentToolUtils.ts`

- Contient les helpers techniques de validation, metadata, et schema

#### `tools/AgentTool/agentColorManager.ts`

- Gere les couleurs associees aux types d'agents

### `tools/AgentTool/built-in`

Ce sous-dossier contient les vraies definitions des agents built-in :

- `general-purpose`
- `Explore`
- `Plan`
- `verification`
- `claude-code-guide`
- `statusline-setup`

## Outils de `tools/` qui pilotent les agents

Ces sous-dossiers ne definissent pas de nouveaux agents, mais ils servent a les piloter, les suivre, ou les orchestrer.

### `tools/SendMessageTool`

- Tool : `SendMessage`
- Role : envoyer un message a un agent deja lance
- Usage : continuer un agent existant, lui donner une nouvelle instruction, ou diffuser un message

### `tools/TaskCreateTool`

- Tool : `TaskCreate`
- Role : creer une tache dans la task list
- Usage : suivi structure du travail a faire

### `tools/TaskGetTool`

- Tool : `TaskGet`
- Role : recuperer une tache par ID

### `tools/TaskListTool`

- Tool : `TaskList`
- Role : lister toutes les taches

### `tools/TaskOutputTool`

- Tool : `TaskOutput`
- Role : recuperer la sortie d'une tache de fond ou d'un agent
- Usage : lire le resultat d'un background task ou d'un agent en cours / termine

### `tools/TaskStopTool`

- Tool : `TaskStop`
- Role : arreter une tache de fond
- Usage : stopper un agent ou une tache en execution

### `tools/TaskUpdateTool`

- Tool : `TaskUpdate`
- Role : modifier une tache
- Usage : changer le statut, le sujet, les blocages, le proprietaire, etc.

### `tools/TeamCreateTool`

- Tool : `TeamCreate`
- Role : creer une equipe multi-agents
- Usage : initialiser un swarm avec un `team-lead`

### `tools/TeamDeleteTool`

- Tool : `TeamDelete`
- Role : nettoyer et dissoudre une equipe multi-agents
- Usage : fin du swarm, suppression des repertoires et nettoyage d'etat

## Ce qui est un agent, et ce qui n'en est pas un

Pour etre clair :

### Ce qui est un vrai type d'agent

- `general-purpose`
- `Explore`
- `Plan`
- `verification`
- `claude-code-guide`
- `statusline-setup`
- `fork`
- `team-lead`
- `worker`

### Ce qui n'est pas un agent, mais un outil d'orchestration

- `Agent` : le tool qui lance les agents
- `SendMessage` : le tool qui parle a un agent deja lance
- `TaskCreate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`, `TaskUpdate`
- `TeamCreate`, `TeamDelete`

Donc :

- le dossier `tools/` contient bien tout le systeme autour des agents
- mais il ne faut pas confondre `types d'agents` et `tools de pilotage`

## Tableau recapitulatif

| Nom | Categorie | Etat dans ce snapshot | Role |
| --- | --- | --- | --- |
| `general-purpose` | built-in | defini | agent polyvalent |
| `Explore` | built-in | defini | exploration read-only |
| `Plan` | built-in | defini | planification read-only |
| `verification` | built-in | defini | verification et verdict |
| `claude-code-guide` | built-in | defini | aide / documentation |
| `statusline-setup` | built-in | defini | configuration status line |
| `fork` | synthetique | defini | fork implicite avec heritage du contexte |
| `team-lead` | role reserve | defini comme constante / identite | chef d'equipe swarm |
| `worker` | role reserve | reference, implementation manquante ici | agent executeur du coordinator mode |

## Comptage utile

Selon le niveau de precision :

- `6` agents built-in reels
- `8` types confirmes si on ajoute `fork` et `team-lead`
- `9` types visibles si on ajoute aussi `worker`

Le chiffre `9` est le plus complet pour ce snapshot, a condition de noter que :

- `worker` est visible et utilise
- mais son implementation concrete n'est pas presente dans ce dossier

## Conclusion

Pour ce depot uniquement, la lecture la plus solide est la suivante :

1. le systeme expose `6` agents built-in reels
2. il ajoute aussi des roles ou agents synthetiques comme `fork`, `team-lead`, et `worker`
3. il sait charger des agents custom et plugin, mais aucun n'est fourni dans ce snapshot

Donc la liste complete visible dans ce snapshot est :

1. `general-purpose`
2. `Explore`
3. `Plan`
4. `verification`
5. `claude-code-guide`
6. `statusline-setup`
7. `fork`
8. `team-lead`
9. `worker`
