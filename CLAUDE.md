# Frais — notes de frais Dreams Home Concept

Application web (PWA) publiée par GitHub Pages depuis `main`. Pas d'outil de build.
- `index.html` : toute l'application (CSS + HTML + scripts). Firebase compat 10.12.2 depuis gstatic.
- `sw.js` : service worker (ouverture hors ligne). Page en réseau d'abord, bibliothèques et logos en cache.
- `firestore.rules` : règles de sécurité, à publier à la main dans la console Firebase après fusion.
- `apps-script/Code.gs` : copie du script Google (envoi des emails, lecture des tickets par Claude), à recopier à la main dans Apps Script.
- `tests/` : tests des règles Firestore dans l'émulateur (`cd tests && npm install && npm test`).

## Règles de travail
- Travailler sur une branche `claude/…`, jamais sur `main`. Mise en production = Pull Request fusionnée par le propriétaire.
- À chaque version publiée, changer **les deux** : `APP_VERSION` dans `index.html` et `version.json`.
  Les applications ouvertes lisent `version.json` et se rechargent seules quand le numéro augmente.
- Les dépenses écrites en base doivent respecter `contenuValide()` des règles (liste fermée de champs) :
  tout nouveau champ d'une dépense doit y être ajouté, sinon l'enregistrement est refusé.
- Écritures des déclarants via `ecrire()` : hors ligne, la saisie est gardée sur le téléphone.
- Le propriétaire est non développeur et francophone : répondre en français, simplement.

## Vérification avant push
Dans le bac à sable cloud, gstatic et jsDelivr sont bloqués : servir les bibliothèques depuis les paquets npm
(`npm pack firebase@10.12.2 jspdf@4.2.1 jspdf-autotable@5.0.8`) en interceptant les requêtes avec Playwright
(`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` pour intercepter aussi celles du service worker).
Tester connecté avec les émulateurs Firebase (`firebase emulators:exec --only auth,firestore`) et `http://localhost:…/?emu`
(branchement aux émulateurs, actif seulement sur localhost) : saisie, justificatif, trajet, PDF, validation,
passage hors ligne puis retour du réseau, en 390×844 et sur ordinateur.
