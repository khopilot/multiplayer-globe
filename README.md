# Multiplayer Globe

Une application interactive montrant les visiteurs du site en temps réel sur un globe 3D.

## Technologies utilisées

- **Cloudflare Workers** avec **Durable Objects** pour la synchronisation en temps réel
- **PartyKit** pour la gestion des WebSockets
- **React** pour l'interface utilisateur
- **Cobe** pour la visualisation du globe 3D

## Installation

1. Installer les dépendances :
   ```bash
   npm install
   ```

2. Lancer le serveur de développement :
   ```bash
   npm run dev
   ```

3. Déployer sur Cloudflare :
   ```bash
   npm run deploy
   ```

## URL de production

L'application est déployée sur : https://multiplayer-globe.pienikdelrieu.workers.dev/
