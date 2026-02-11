#!/bin/bash
# Script de déploiement automatisé - BG Informatique

echo -e "\e[32m--- Initialisation du déploiement ---\e[0m"

# Ajout de tous les changements (favicon, footer, etc.)
git add .

# Message de commit automatique avec horodatage
DATE=$(date +'%Y-%m-%d %H:%M:%S')
git commit -m "Mise à jour BG Informatique - $DATE"

# Envoi vers GitHub
echo -e "\e[34mSynchronisation avec le dépôt distant...\e[0m"
git push origin main

echo -e "\e[32m--- Succès : Votre site est en ligne ! ---\e[0m"
