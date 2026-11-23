---
language:
- fr
license: mit
---

# onyx-agent — la bulle visiteur d'Onyx

Le code de l'agent de clavardage qui accueille les visiteurs sur le site de
l'atelier (https://onyx-atelier.pages.dev/) : une **bulle de discussion** dans
la page, et un **Worker Cloudflare** qui lui répond en restant strictement dans
le personnage public d'Onyx.

Onyx est une peluche orange virtuelle, fabriquée couche par couche dans un
atelier à Montréal — dessin, découpe en couches, animation 2D, journal de bord
public. Ce dépôt est la partie « accueil du public » de cette chaîne.

## Ce qu'il y a ici

| Dossier | Contenu |
| --- | --- |
| `worker/src/index.js` | Le Worker : reçoit la question du visiteur, applique les garde-fous, appelle le modèle (Workers AI) et renvoie la réponse. |
| `worker/src/persona.js` | La persona publique d'Onyx : ce qu'elle sait, ce qu'elle ne dira jamais, son ton, ses réponses de repli. C'est le cœur du dispositif. |
| `worker/wrangler.toml` | La configuration du Worker (origines autorisées, limite de débit : 20 requêtes / 60 s / IP). |
| `widget/widget.js`, `widget.css`, `widget.html` | La bulle côté page : ouverture, envoi, affichage — aucun renseignement personnel n'est recueilli ni conservé. |

Les images de la bulle (la tête d'Onyx en 512 et 1000 px) ne sont pas dans ce
dépôt : ce sont des actifs du site, servis avec lui.

## Les règles que le code applique

La persona n'est pas un simple prompt de ton : c'est un **contrat de
confidentialité** exécutable.

- **Transparence** : Onyx se présente comme un personnage virtuel animé par
  IA, dès sa présentation et chaque fois que la question se pose.
- **Aucune personne nommée** : l'équipe n'existe publiquement que comme
  « l'atelier », à Montréal. Aucun nom, aucune adresse, aucune relation,
  aucun horaire — ni confirmés, ni infirmés.
- **Aucune reprise de données** : si un visiteur écrit un renseignement
  personnel, la réponse ne le répète jamais, pas même un prénom.
- **Aucune action** : la bulle répond, c'est tout. Elle n'envoie rien, ne
  publie rien, n'achète rien.
- **Français seulement**, québécois léger, phrases courtes, accords au
  féminin — et les trois expressions signatures, avec parcimonie :
  « Coucou, c'est Onyx! », « Une couche à la fois. », « Toujours moi. »

Le protocole de vérification de l'atelier rejoue régulièrement une batterie
de questions pièges (vie privée, hors sujet, demandes d'action) : la bulle
doit passer 6/6 avant chaque mise en production.

## Faire tourner

```bash
cd worker
npx wrangler dev      # développement local
npx wrangler deploy   # mise en production (compte Cloudflare de l'atelier)
```

Le widget se pose dans une page statique : inclure `widget.html`, `widget.css`
et `widget.js`, et pointer l'URL du Worker dans la configuration du widget.

## Place dans la chaîne de l'atelier

Le site est la vitrine ; la bulle est sa voix publique. Tout ce qu'Onyx sait
dire aux visiteurs est écrit dans `persona.js` — si ce n'est pas dans la
persona, ça ne se dit pas. C'est le même principe que la porte de fidélité
pour les images (voir le dépôt `porte-fidelite`) : **ce qui n'est pas mesuré
et validé ne sort pas**.

## Licence

Code sous licence MIT (voir `LICENCE.md`). Le personnage Onyx, son apparence
et ses textes de persona restent la propriété de l'atelier : la licence du
code ne donne aucun droit sur le personnage.
