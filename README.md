# AI Maxxing Skills

Les skills Claude Code que j'utilise dans la formation gratuite **"Comment créer ton SaaS personnel en moins de 30 minutes"**. Tu les installes une fois, et Claude sait créer, déployer, sécuriser et vendre ton application tout seul, avec la stack Cloudflare, Convex, Lumail et Stripe.

- La formation et la ressource complète (stack, étapes, prompts) : [codelynx.dev/fx](https://codelynx.dev/fx)
- Le lien court à partager : [mlv.sh/fx](https://mlv.sh/fx)
- La plateforme créée en direct dans la vidéo : [formations.ai-maxxing.pro](https://formations.ai-maxxing.pro)

## Installation en une commande

Dans ton terminal :

```bash
npx skills add Melvynx/ai-maxxing-skills -g -a claude-code -s '*' -y
```

Les 11 skills sont installés dans `~/.claude/skills/`. Relance Claude Code (ou ouvre une nouvelle session dans l'app Claude, onglet **Code**) et tape `/` pour les voir.

Tu préfères demander à Claude ? Colle ce prompt dans une session :

```
Installe tous les skills du repo https://github.com/Melvynx/ai-maxxing-skills dans ~/.claude/skills (un dossier par skill, avec son SKILL.md et ses références), puis liste-les.
```

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
| [`setup-brain`](skills/setup-brain/SKILL.md) | Monte ton "brain" : un seul dossier où Claude range tout par projet (projets, sous-projets, notes, skills), avec un `AGENTS.md` qui lui dit qui tu es et où tout se trouve. 5 questions, puis il crée la structure, tes premiers projets et la sauvegarde git. | `/setup-brain` dans une nouvelle session, à faire en premier. |
| [`grill-me`](skills/grill-me/SKILL.md) | Claude te pose 10 questions à la fois, chacune avec une réponse recommandée, puis te donne un brief à valider avant de coder. Le skill promis dans la vidéo. | Ajoute `/grill-me` à la fin de ton prompt de création. |
| [`personal-saas`](skills/personal-saas/SKILL.md) | Tout le process de la formation dans un skill : vérifie tes accès (GitHub, Cloudflare, Convex, Lumail), construit l'app TanStack Start + Convex + Better Auth, branche Stripe et Lumail, déploie sur ton domaine Cloudflare et teste en vrai. Il fait tout lui-même. | `/personal-saas une plateforme de formation sur formation.mon-domaine.com` |
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
