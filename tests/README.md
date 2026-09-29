# Tests des règles Firestore

Vérifie dans l'émulateur Firebase que `../firestore.rules` bloque les accès interdits
(salarié qui se nomme administrateur, valide ses frais, lit ceux d'un collègue, montant incohérent…)
et laisse passer l'usage normal de l'application.

```
cd tests
npm install
npm test
```

Nécessite Java. Chaque ligne affiche `OK` ou `ÉCART` ; le test échoue s'il y a au moins un écart.
