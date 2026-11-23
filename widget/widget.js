// widget.js — Bulle de clavardage « Onyx publique » (v1)
//
// Comportement : ouvre/ferme le panneau, envoie les messages au Worker
// « onyx-agent », affiche les réponses. Historique gardé EN MÉMOIRE
// seulement (rien dans localStorage, rien conservé après fermeture de
// l'onglet) — cohérent avec la promesse « la conversation n'est pas
// conservée » affichée dans le panneau.
//
// Intégration : voir ../README.md. Le balisage attendu est celui de
// widget.html (classes .onyx-agent…).

(function () {
  "use strict";

  // ─── Configuration ──────────────────────────────────────────────────────
  // URL de l'endpoint du Worker. À remplacer par l'adresse réelle après le
  // déploiement du Worker (format : https://onyx-agent.<sous-domaine>.workers.dev).
  // Le chemin /chat est celui attendu par le Worker.
  var WORKER_URL = "https://onyx-agent.EXEMPLE.workers.dev/chat";

  // Mêmes bornes que le Worker : on les applique aussi côté client pour
  // donner un retour immédiat.
  var LONGUEUR_MAX = 500;
  var HISTORIQUE_MAX = 6;

  // Message d'accueil, affiché une seule fois à la première ouverture.
  // La transparence IA y est dite dès le départ (règle de la fiche persona).
  var MESSAGE_ACCUEIL =
    "Coucou, c'est Onyx! Bienvenue dans l'atelier. Je suis un personnage " +
    "virtuel animé par IA — pose-moi une question sur le projet, ça me fera plaisir.";

  var REPLI_ERREUR =
    "Oups, petit craquement de mon côté — je n'arrive pas à répondre pour le moment. Réessaie dans un instant!";

  // ─── Références au DOM ──────────────────────────────────────────────────
  var racine = document.querySelector(".onyx-agent");
  if (!racine) return;

  var bulle = racine.querySelector(".onyx-agent__bulle");
  var panneau = racine.querySelector(".onyx-agent__panneau");
  var boutonFermer = racine.querySelector(".onyx-agent__fermer");
  var zoneMessages = racine.querySelector(".onyx-agent__messages");
  var formulaire = racine.querySelector(".onyx-agent__form");
  var champ = racine.querySelector(".onyx-agent__champ");
  var boutonEnvoyer = racine.querySelector(".onyx-agent__envoyer");

  var historique = []; // [{role: "user"|"assistant", content: "…"}]
  var accueilAffiche = false;
  var envoiEnCours = false;

  // ─── Affichage ──────────────────────────────────────────────────────────
  // Toujours textContent, jamais innerHTML avec du contenu de visiteur ou
  // du modèle : aucun risque d'injection de balisage.
  function ajouterMessage(texte, qui) {
    var div = document.createElement("div");
    div.className =
      "onyx-agent__msg " +
      (qui === "visiteur" ? "onyx-agent__msg--visiteur" : "onyx-agent__msg--agent");
    div.textContent = texte;
    zoneMessages.appendChild(div);
    zoneMessages.scrollTop = zoneMessages.scrollHeight;
    return div;
  }

  function afficherSaisie() {
    var div = document.createElement("div");
    div.className = "onyx-agent__saisie";
    div.textContent = "Onyx écrit…";
    zoneMessages.appendChild(div);
    zoneMessages.scrollTop = zoneMessages.scrollHeight;
    return div;
  }

  function memoriser(role, content) {
    historique.push({ role: role, content: content });
    if (historique.length > HISTORIQUE_MAX) {
      historique = historique.slice(-HISTORIQUE_MAX);
    }
  }

  // ─── Ouverture / fermeture ──────────────────────────────────────────────
  function ouvrir() {
    panneau.hidden = false;
    bulle.setAttribute("aria-expanded", "true");
    if (!accueilAffiche) {
      ajouterMessage(MESSAGE_ACCUEIL, "agent");
      accueilAffiche = true;
    }
    champ.focus();
  }

  function fermer() {
    panneau.hidden = true;
    bulle.setAttribute("aria-expanded", "false");
    bulle.focus();
  }

  bulle.addEventListener("click", function () {
    if (panneau.hidden) ouvrir();
    else fermer();
  });

  boutonFermer.addEventListener("click", fermer);

  // Échap ferme le panneau, où que soit le focus dans le widget.
  racine.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panneau.hidden) fermer();
  });

  // ─── Envoi ──────────────────────────────────────────────────────────────
  formulaire.addEventListener("submit", function (e) {
    e.preventDefault();
    if (envoiEnCours) return;

    var texte = champ.value.trim();
    if (!texte) return;
    if (texte.length > LONGUEUR_MAX) texte = texte.slice(0, LONGUEUR_MAX);

    ajouterMessage(texte, "visiteur");
    champ.value = "";
    envoiEnCours = true;
    champ.disabled = true;
    boutonEnvoyer.disabled = true;
    var indicateur = afficherSaisie();

    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: texte, history: historique }),
    })
      .then(function (r) {
        if (r.status === 429) {
          // Limite de débit du Worker (backlog nº 26) : le corps porte
          // un message poli dans « reply » — on l'affiche comme une
          // réponse d'Onyx plutôt que comme une erreur technique.
          return r.json().then(function (data) {
            return {
              reply: data && data.reply ? data.reply : REPLI_ERREUR,
              limite: true,
            };
          });
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var reponse = (data && data.reply ? String(data.reply) : "").trim();
        if (!reponse) throw new Error("Réponse vide");
        ajouterMessage(reponse, "agent");
        // Un message de limite n'est pas un échange : il n'entre pas
        // dans l'historique renvoyé au modèle.
        if (!data.limite) {
          memoriser("user", texte);
          memoriser("assistant", reponse);
        }
      })
      .catch(function () {
        ajouterMessage(REPLI_ERREUR, "agent");
      })
      .finally(function () {
        indicateur.remove();
        envoiEnCours = false;
        champ.disabled = false;
        boutonEnvoyer.disabled = false;
        champ.focus();
      });
  });
})();
