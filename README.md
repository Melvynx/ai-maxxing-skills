# AI Maxxing Skills

Les skills Claude Code que j'utilise dans la formation gratuite **"Comment créer ton SaaS personnel en moins de 30 minutes"**. Tu les installes une fois, et Claude sait créer, déployer, sécuriser et vendre ton application tout seul, avec la stack Cloudflare, Convex, Lumail et Stripe.

- La formation et la ressource complète (stack, étapes, prompts) : [codelynx.dev/aimaxxing/get](https://codelynx.dev/aimaxxing/get)
- Le lien court à partager : [mlv.sh/fx](https://mlv.sh/fx)
- La plateforme créée en direct dans la vidéo : [formations.ai-maxxing.pro](https://formations.ai-maxxing.pro)

## Installation en une commande

Dans ton terminal :

```bash
npx skills add Melvynx/ai-maxxing-skills -g -a claude-code -s '*' -y
```

Les 27 skills sont installés dans `~/.claude/skills/`. Relance Claude Code (ou ouvre une nouvelle session dans l'app Claude, onglet **Code**) et tape `/` pour les voir.

Mac ou PC tout neuf, sans Node ni Git ? La commande `npx` ne marchera pas encore. Colle plutôt ce prompt dans une session Claude (onglet **Code**), il n'a besoin de rien d'installé :

```
Télécharge l'archive https://github.com/Melvynx/ai-maxxing-skills/archive/refs/heads/main.tar.gz avec curl, extrais-la avec tar dans un dossier temporaire, copie chaque dossier de skills/ dans ~/.claude/skills (avec son SKILL.md, ses scripts et ses références), puis liste les skills installés. N'utilise ni git ni npm.
```

## Par où commencer

Dans cet ordre, une seule fois, chacun dans une nouvelle session. Chaque skill s'adapte à ton système (macOS, Linux ou Windows), saute ce qui est déjà prêt et finit par une check-list :

1. `/setup-node` : installe Homebrew (sur Mac, ton mot de passe Mac une seule fois) et Node.js.
2. `/setup-github` : Git, le CLI GitHub, la connexion à ton compte et ton nom dans les commits.
3. `/setup-brain` : ton dossier de travail avec son `AGENTS.md`.
4. `/setup-dev-browser` : le Chrome dédié à Claude.
5. `/setup-cloudflare`, `/setup-convex`, `/setup-lumail`, puis `/setup-stripe` si tu vends.
6. `/connect-vps hostinger` : quand tu as acheté ton VPS, le raccourci `ssh hermes` pour y entrer.
7. `/setup-vps mon-domaine.com` : ton agent Hermes sur le VPS, joignable sur Telegram ou Discord, avec son dashboard protégé.
8. `/setup-my-hermes-dashboard mon-domaine.com` : ton dashboard perso, vide au départ, où Hermes ajoute les modules que tu lui demandes. Ou écris simplement à Hermes "crée mon dashboard".
9. `/install-skills` : `/setup-vps` installe déjà le pack par défaut de Hermes sur le serveur (`create-dashboard`, `connect-tool`, `create-internal-app` et les skills de ses outils, la liste est dans [`skills/setup-vps/hermes-pack`](skills/setup-vps/hermes-pack)). Ce skill ajoute ceux du kit que tu veux aussi donner à Hermes (`create-landing`, `lumail`, `verify`...). Tu peux aussi écrire directement à Hermes sur Telegram "installe le pack par défaut" ou "installe le skill lumail".

Tu n'as pas envie de tout installer ? Lance un seul skill avec son lien, sans rien installer avant. Claude lit le skill et ne télécharge que les fichiers dont il a besoin :

```text
Setup my GitHub with: https://github.com/Melvynx/ai-maxxing-skills/tree/main/skills/setup-github
```

Ça marche pareil avec n'importe quel skill : remplace `setup-github` par son nom.

### Installation manuelle

```bash
git clone --depth 1 https://github.com/Melvynx/ai-maxxing-skills.git
mkdir -p ~/.claude/skills
cp -R ai-maxxing-skills/skills/* ~/.claude/skills/
```

Pour un seul projet, copie les dossiers dans `.claude/skills/` à la racine du projet au lieu de `~/.claude/skills/`.

Pour mettre à jour : relance la commande d'installation (ou `git pull` puis la copie).

## Les skills

| Skill | Ce qu'il fait | Comment l'utiliser |
| --- | --- | --- |
| [`setup-node`](skills/setup-node/SKILL.md) | Installe Node.js (et donc `npm` et `npx`) sans mot de passe administrateur : Homebrew s'il est là, sinon la version officielle dans ton dossier perso, `winget` sur Windows. Les autres skills le lancent tout seuls si Node manque. | `/setup-node`, à faire en premier sur un ordi neuf. |
| [`setup-github`](skills/setup-github/SKILL.md) | Rend Git utilisable (les outils Apple sur Mac), installe le CLI GitHub, te connecte avec un code à usage unique dans le navigateur, sans mot de passe ni token, et règle ton nom et ton email dans Git. | `/setup-github` |
| [`setup-cloudflare`](skills/setup-cloudflare/SKILL.md) | Installe le CLI officiel `cf`, te connecte à Cloudflare dans le navigateur, choisit le bon compte et liste tes domaines. | `/setup-cloudflare` |
| [`setup-convex`](skills/setup-convex/SKILL.md) | Te connecte à Convex depuis le terminal (création du compte avec GitHub ou Google au passage), pour que Claude crée les bases de données de tes apps. | `/setup-convex` |
| [`setup-lumail`](skills/setup-lumail/SKILL.md) | Connecte ton compte Lumail à Claude dans le navigateur, sans coller de clé API dans le chat. | `/setup-lumail` |
| [`setup-stripe`](skills/setup-stripe/SKILL.md) | Installe le CLI Stripe et l'associe à ton compte en mode test avec un code de vérification, pour que Claude crée tes produits et teste les paiements. | `/setup-stripe`, seulement si ton app vend. |
| [`setup-brain`](skills/setup-brain/SKILL.md) | Monte ton "brain" : un seul dossier où Claude range tout par projet (projets, sous-projets, notes, skills), avec un `AGENTS.md` qui lui dit qui tu es et où tout se trouve. 5 questions, puis il crée la structure, tes premiers projets et la sauvegarde git. | `/setup-brain` dans une nouvelle session, à faire en premier. |
| [`connect-tool`](skills/connect-tool/SKILL.md) | Branche n'importe quel outil à Claude : installe son CLI officiel (Notion, Stripe...) ou, s'il n'en a pas (ClickFunnels, Kajabi...), écrit un petit script Python avec ta clé API. Puis crée un skill disponible partout. | `/connect-tool notion` ou `/connect-tool clickfunnels` |
| [`connect-google`](skills/connect-google/SKILL.md) | Branche ton compte Google (Gmail, Agenda, Drive, Docs, Sheets, Slides, Contacts, Tâches) à tous tes agents avec le CLI `gog`, tout seul : Claude crée le projet Google Cloud et la clé dans Chrome AI, puis t'affiche les pages de connexion Google, tu choisis juste ton compte et tu cliques "Autoriser". | `/connect-google`, après `/setup-dev-browser`. |
| [`setup-dev-browser`](skills/setup-dev-browser/SKILL.md) | Donne à Claude son propre Chrome : une fenêtre "Chrome AI" séparée de ton Chrome perso, où tu te connectes une fois à tes outils (Google, GitHub, Stripe, Lumail...). Installe le CLI `dev-browser`, le lanceur `chrome-ai`, une app dans Spotlight, et vérifie que tes connexions tiennent après un redémarrage. | `/setup-dev-browser` une fois, après `/setup-brain`. |
| [`dev-browser`](skills/dev-browser/SKILL.md) | Claude pilote ta fenêtre Chrome AI : ouvre des sites, clique, remplit des formulaires, lit les pages, fait des captures, vérifie ton app en ligne en étant connecté. Il s'arrête pour te laisser te connecter et te demande avant d'envoyer, payer ou supprimer. | "Ouvre mon dashboard Stripe et dis-moi les ventes d'hier." |
| [`connect-vps`](skills/connect-vps/SKILL.md) | Branche le VPS que tu as acheté (Hostinger, Hetzner, OVH...) : Claude ouvre ton espace client dans Chrome AI, trouve le serveur et l'endroit des clés SSH, crée la clé et le raccourci `ssh hermes` dans ton terminal, sans mot de passe ensuite. Puis il dit à tous tes agents (brain, Claude Code, Codex) que le serveur est là pour tes sites et tes apps. | `/connect-vps hostinger` |
| [`setup-vps`](skills/setup-vps/SKILL.md) | Transforme ton VPS en agent qui tourne 24h/24 : copie tes accès GitHub et Cloudflare sur le serveur (l'accès Cloudflare ne marche que depuis le serveur), installe Claude Code et Hermes avec le modèle recommandé (Opus, effort medium, modifiable), branche Telegram ou Discord pour lui parler, et met son dashboard sur `hermes.mon-domaine.com`. Toutes les pages que le serveur met en ligne passent par la même page de connexion (email + mot de passe, bloquée après trop d'essais), où tu peux sauvegarder l'IP de chez toi pour ne plus te connecter (jamais un Wi-Fi public ni la 4G). | `/setup-vps mon-domaine.com`, après `/connect-vps`. |
| [`setup-my-hermes-dashboard`](skills/setup-my-hermes-dashboard/SKILL.md) | Met ton dashboard perso sur `dashboard.mon-domaine.com`, avec le même look et les mêmes outils que le dashboard Hermes (TanStack Start, Tailwind, SQLite), derrière la même page de connexion. Il démarre vide : tu demandes à Hermes "ajoute un module qui montre mes conversations" (ou tes crons, un rapport du matin, tes ventes du jour) et il le code, le teste, le met en ligne et le sauvegarde sur ton GitHub. | `/setup-my-hermes-dashboard mon-domaine.com`, après `/setup-vps`. |
| [`install-skills`](skills/install-skills/SKILL.md) | Hermes a déjà son pack par défaut (`create-dashboard`, `connect-tool`, `create-internal-app` et les skills de ses outils). Ce skill installe sur ton VPS ceux du kit que tu veux en plus (`create-landing`, `create-software`, `lumail`, `verify`...), dans le dossier que Hermes lit. Après, Hermes sait aussi le faire tout seul : "quels skills tu peux installer ?", "installe connect-tool", "mets à jour tes skills". Tes propres skills ne sont jamais touchés. | `/install-skills`, ou `/install-skills connect-tool verify`, après `/setup-vps`. |
| [`grill-me`](skills/grill-me/SKILL.md) | Claude te pose 10 questions à la fois sur l'app que tu veux (pour qui, l'action principale, les données, qui voit quoi, le prix, les emails, le domaine, le design, la v1), chacune avec une réponse recommandée, puis te donne un brief à valider avant de coder. `create-software`, `create-internal-app` et `create-landing` le lancent tout seuls. | Automatique avec `/create-software`, `/create-internal-app` et `/create-landing`, ou `/grill-me` à la fin de n'importe quel prompt. |
| [`create-landing`](skills/create-landing/SKILL.md) | Crée une landing page, une page de vente ou une waitlist sur Cloudflare, sans base de données ni connexion : TanStack Start, shadcn/ui + Base UI, formulaire email branché sur Lumail (avec double opt-in, c'est un formulaire à froid), bouton d'achat Stripe ou Codeline en option, copy écrite avec toi avant le code. | `/create-landing une waitlist pour mon app sur mon-domaine.com` |
| [`create-software`](skills/create-software/SKILL.md) | Crée une app web publique hébergée sur Cloudflare, pour des gens qui s'inscrivent ou paient : TanStack Start, shadcn/ui + Base UI, Convex pour tout, les librairies TanStack (données, listes, formulaires, markdown, raccourcis clavier), Better Auth, Lumail (inscrits directement, sans double opt-in) et Stripe si l'app vend. | `/create-software une plateforme de formation sur formation.mon-domaine.com` |
| [`create-internal-app`](skills/create-internal-app/SKILL.md) | Crée un outil interne (CRM, dashboard, back-office) sur ton VPS via Dokploy, géré ensuite par ton agent. URL publique mais verrouillée comme le QG de l'agent : mot de passe, puis seulement tes IP autorisées dans Cloudflare. | `/create-internal-app un CRM perso sur crm.mon-domaine.com` |
| [`cloudflare`](skills/cloudflare/SKILL.md) | Tout Cloudflare avec le CLI officiel `cf` (jamais Wrangler) : domaines, DNS, déploiement des Workers, secrets, R2, cache. | Automatique dès que tu parles de domaine, DNS ou déploiement. |
| [`convex`](skills/convex/SKILL.md) | Setup Convex (dev et prod), schéma et index, vérification des droits dans chaque fonction, et optimisation des lectures quand la base grossit. | Automatique sur tout ce qui touche à la base. |
| [`lumail`](skills/lumail/SKILL.md) | Connexion à Lumail, domaines d'envoi, abonnés, tags, codes de connexion par email, campagnes et workflows automatiques. | "Crée un workflow Lumail qui..." |
| [`stripe-checkout`](skills/stripe-checkout/SKILL.md) | Stripe Checkout en mode test d'abord (carte 4242), puis en production : produits, webhook signé, accès débloqué seulement après un paiement vérifié. | "Voici mes clés Stripe de test, branche le paiement." |
| [`audit-safety`](skills/audit-safety/SKILL.md) | Audit de sécurité d'une fonctionnalité : authentification, droits, isolation des données entre utilisateurs, webhooks, clés secrètes, réponses trop bavardes. Lecture seule, avec preuve `fichier:ligne` pour chaque faille. | `/audit-safety le paiement` avant chaque mise en ligne. |
| [`code-debug`](skills/code-debug/SKILL.md) | Debug méthodique : reproduire le bug, tester des hypothèses une par une, corriger au plus petit, ajouter un test, prouver que c'est réglé. | "Ce bug revient, debug-le." |
| [`verify`](skills/verify/SKILL.md) | Prouve qu'un changement marche vraiment, sur le vrai site ou le vrai service, pas juste "ça compile". | "Vérifie que l'achat marche en prod." |
| [`safe-ship`](skills/safe-ship/SKILL.md) | Commit et push propres : ne prend que les fichiers concernés, lance les vérifications, pousse et contrôle le déploiement. | "Commit et push." |

## La stack

| Outil | Rôle |
| --- | --- |
| [Claude](https://claude.ai/download) (app desktop, onglet Code) | L'IA qui crée, publie et maintient ton application. |
| [GitHub](https://github.com) | Sauvegarde le code. Tu te connectes partout avec ce compte. |
| [Cloudflare](https://dash.cloudflare.com/sign-up) | Hébergement, domaine et DNS. |
| [Convex](https://www.convex.dev) | Base de données et backend. |
| [Lumail](https://lumail.io) | Emails : codes de connexion, newsletters, workflows. |
| [Stripe](https://dashboard.stripe.com/register) | Paiement avec Stripe Checkout. |
| Better Auth | Connexion par code email, installé par Claude. |
| [Tella](https://www.tella.tv) | Hébergement des vidéos de formation. |

## Le prompt de départ

Ouvre une nouvelle session Claude dans un dossier vide et envoie :

```
Crée un nouveau site avec la stack suivante :
1. TanStack Start
2. shadcn/ui + Base UI + Tailwind CSS
3. Convex Database
4. Better Auth
5. Lumail.io pour l'email marketing

But de l'application :
- formation.ton-domaine.com = landing page pour ma formation [nom]. [Pour qui, ce qu'on apprend, le prix.]
- formation.ton-domaine.com/app = application pour suivre la formation : modules, sections, leçons, éditeur admin simple, vidéos Tella par URL.
- Login via code OTP par email uniquement.

/grill-me
```

Ensuite, la règle d'or : réponds "fais-le toi-même" au moins 10 fois avant de lever le petit doigt.

## Sécurité

Ces skills ne contiennent aucune clé ni donnée personnelle. Tes clés (Stripe, Lumail, Cloudflare) restent dans tes variables d'environnement : ne les colle jamais dans un fichier versionné, et lance `/audit-safety` avant de vendre.

## Licence

[MIT](LICENSE). Utilise, modifie et partage librement.

Fait par [Melvyn](https://codelynx.dev).
