// index.js — Worker Cloudflare « onyx-agent » (v1)
//
// Rôle : recevoir les messages du widget de clavardage du site d'Onyx,
// appeler un modèle Workers AI avec la fiche persona comme prompt système,
// et renvoyer la réponse. Rien de plus.
//
// Principes de la v1 :
// - Aucune donnée conservée : ni base, ni KV, ni journal des conversations.
//   L'historique voyage avec la requête et repart avec la réponse.
// - Historique court (quelques échanges) et messages bornés en longueur.
// - CORS restreint aux origines du site (variable ALLOWED_ORIGINS).
// - Commentaires en français, comme tout l'atelier.
//
// Déploiement : voir ../DEPLOIEMENT.md (procédure API reproductible).

import { SYSTEM_PROMPT } from "./persona.js";

// Modèle Workers AI retenu (voir README.md, section « Choix du modèle »).
const MODELE = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Limites v1 — volontaires et basses : l'agent répond court, sur un sujet
// étroit (le projet public). Elles protègent aussi le quota Workers AI.
const LONGUEUR_MAX_MESSAGE = 500; // caractères, par message
const HISTORIQUE_MAX = 6; // messages d'historique gardés (3 échanges)
const JETONS_MAX_REPONSE = 350; // max_tokens côté modèle

// Réponse de repli si le modèle est injoignable : dans le ton, honnête,
// et elle ne promet rien.
const REPLI_PANNE =
  "Oups, petit craquement de mon côté — je n'arrive pas à répondre pour le moment. Réessaie dans un instant, ou écris à iamonyx@muse.ai.";

// Limite de débit (backlog nº 26, audit cybersécurité du 22 nov. 2026).
// Le seuil lui-même est configuré dans la liaison LIMITE_CHAT
// (wrangler.toml : 20 requêtes par 60 secondes et par adresse IP —
// un visiteur qui converse pour vrai n'y arrive jamais : le widget
// envoie un message à la fois et chaque réponse prend quelques
// secondes ; un script qui inonde, lui, s'y heurte tout de suite).
// Message renvoyé quand le plafond est atteint : court, dans le ton,
// et il invite à revenir un peu plus tard. Il part dans le champ
// « reply » pour que le widget l'affiche comme une réponse d'Onyx.
const MESSAGE_LIMITE =
  "Oups, doucement! Tu m'en demandes beaucoup d'un coup — laisse-moi reprendre mon souffle, et reviens me parler dans une petite minute.";

// --- Utilitaires -----------------------------------------------------------

// Origines autorisées : variable d'environnement ALLOWED_ORIGINS
// (liste séparée par des virgules). À défaut, le site de production seul.
function originesAutorisees(env) {
  const brut = env.ALLOWED_ORIGINS || "https://onyx-atelier.pages.dev";
  return brut
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// En-têtes CORS : on ne renvoie l'origine que si elle est autorisée.
// Sinon, aucun en-tête — le navigateur bloquera l'appel, c'est voulu.
function entetesCors(env, request) {
  const origine = request.headers.get("Origin") || "";
  const autorisees = originesAutorisees(env);
  if (!autorisees.includes(origine)) return {};
  return {
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reponseJson(corps, statut, entetes) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", ...entetes },
  });
}

// Nettoie et borne l'historique reçu : rôles valides seulement, longueur
// bornée, on ne garde que les derniers messages. Tout contenu suspect
// (non-texte, rôle « system » d'un visiteur…) est jeté, jamais interprété.
function nettoyerHistorique(historique) {
  if (!Array.isArray(historique)) return [];
  return historique
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, LONGUEUR_MAX_MESSAGE),
    }))
    .slice(-HISTORIQUE_MAX);
}

// --- Point d'entrée ---------------------------------------------------------

export default {
  async fetch(request, env) {
    const cors = entetesCors(env, request);
    const url = new URL(request.url);

    // Pré-vol CORS.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Petit point de santé, utile après le déploiement.
    if (request.method === "GET" && url.pathname === "/") {
      return reponseJson({ statut: "ok", service: "onyx-agent" }, 200, cors);
    }

    if (request.method !== "POST" || url.pathname !== "/chat") {
      return reponseJson({ erreur: "Route introuvable." }, 404, cors);
    }

    // Origine obligatoire et autorisée pour les appels réels.
    if (!cors["Access-Control-Allow-Origin"]) {
      return reponseJson({ erreur: "Origine non autorisée." }, 403, {});
    }

    // Limite de débit, AVANT tout appel au modèle : plafond par adresse
    // IP sur la fenêtre de la liaison LIMITE_CHAT. L'adresse ne sert
    // qu'à former la clé du compteur du runtime — elle n'est ni
    // journalisée ni conservée ici. Si la liaison est absente
    // (déploiement sans elle), on laisse passer : la bulle ne doit
    // jamais tomber pour un garde-fou manquant.
    if (env.LIMITE_CHAT) {
      const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
      const { success } = await env.LIMITE_CHAT.limit({ key: ip });
      if (!success) {
        return reponseJson({ reply: MESSAGE_LIMITE }, 429, {
          ...cors,
          "Retry-After": "60",
        });
      }
    }

    // Lecture et validation du corps.
    let corps;
    try {
      corps = await request.json();
    } catch {
      return reponseJson({ erreur: "Corps JSON invalide." }, 400, cors);
    }

    const message =
      typeof corps.message === "string" ? corps.message.trim() : "";
    if (!message) {
      return reponseJson({ erreur: "Message manquant." }, 400, cors);
    }
    if (message.length > LONGUEUR_MAX_MESSAGE) {
      return reponseJson(
        {
          erreur: `Message trop long (maximum ${LONGUEUR_MAX_MESSAGE} caractères).`,
        },
        400,
        cors
      );
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...nettoyerHistorique(corps.history),
      { role: "user", content: message },
    ];

    // Appel au modèle. Aucune conservation : la réponse repart au widget,
    // et c'est tout.
    try {
      const resultat = await env.AI.run(MODELE, {
        messages,
        max_tokens: JETONS_MAX_REPONSE,
        temperature: 0.7,
      });
      const texte = (resultat && resultat.response ? String(resultat.response) : "").trim();
      if (!texte) throw new Error("Réponse vide du modèle");
      return reponseJson({ reply: texte }, 200, cors);
    } catch (e) {
      // On ne journalise pas le contenu des conversations; l'erreur
      // technique suffit au dépannage.
      console.error("Échec Workers AI:", e && e.message ? e.message : e);
      return reponseJson({ reply: REPLI_PANNE }, 502, cors);
    }
  },
};
