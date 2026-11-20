# Daily_Orders_Emailer

Workflow n8n qui envoie les emails de suivi de commande tous les jours à 7h (heure de Paris). Les emails sont écrits dans l'onglet Outbox du Google Sheet au lieu d'être réellement envoyés.

## Contenu

- Daily_Orders_Emailer.json : le workflow à importer dans n8n
- Qwokka_orders_demo.xlsx : le Google Sheet d'exemple (onglets orders, Outbox et errors)
- src/decision.js : le code du nœud "Décider les emails"
- test/decision.test.js : quelques tests, à lancer avec `node --test`

## Mise en place

1. Importer le xlsx dans Google Sheets.
2. Importer le JSON dans n8n et choisir un credential Google Sheets sur les 4 nœuds Google Sheets.
3. Dans le nœud Config, renseigner l'ID du Google Sheet et l'adresse interne. Le champ demo_today permet de simuler une date. On le laisse vide en production.

Les données d'exemple sont prévues pour demo_today = 2026-12-01. La colonne attendu_2026-12-01 donne le résultat attendu pour chaque ligne.

## Fonctionnement

Le workflow lit d'abord l'Outbox pour savoir ce qui a déjà été envoyé, puis il lit les commandes. Le nœud Code décide quels emails partir et quelles erreurs remonter. Les emails sont envoyés par lots de 5, avec 2 secondes d'attente entre chaque lot. Les erreurs sont écrites dans l'onglet errors.

Les échéances sont comptées en jours entre aujourd'hui et delivery_date_to :

- 72h : commande confirmée, à partir de J-3
- préparation sans retard / en retard : dès que la commande est en préparation, en retard si le 72h est déjà parti
- 24h : en préparation à partir de J-1, sauf si le 72h est déjà parti
- interne : toujours confirmée à partir de J+10

## Choix

- Anti-doublon : chaque email a une clé numéro de commande + type d'email. Un email déjà présent dans l'Outbox n'est jamais renvoyé, même si on relance le workflow.
- Passage en préparation : le Sheet ne garde que le statut actuel. Je considère donc que la commande vient de passer en préparation si elle est En_preparation et qu'aucun email de préparation n'a encore été envoyé.
- Retard détecté plus tôt : je considère qu'un retard a été détecté quand l'email 72h a été envoyé.
- Rattrapage : j'utilise "à partir de J-3" plutôt que "exactement J-3". Si le workflow ne tourne pas un jour, l'email part le lendemain.
- Un seul email client par commande et par jour. Par exemple, si une commande passe en préparation à J-1, le 24h part le lendemain.
- Erreurs : un numéro vide ou en double, un statut inconnu ou une date invalide font ignorer la ligne. Si l'email client est invalide, aucun email n'est envoyé au client, mais l'email interne part quand même.
- Les dates sont acceptées en date Google Sheets ou en texte YYYY-MM-DD.
- Pour un vrai envoi, il suffit d'ajouter un nœud Send Email avant "Écrire dans Outbox".
