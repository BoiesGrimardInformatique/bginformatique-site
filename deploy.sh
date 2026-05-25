#!/bin/bash
# ==========================================================
#  Script de déploiement - BG Informatique
#  Usage : ./deploy.sh ["message de commit optionnel"]
# ==========================================================

set -euo pipefail  # Arrête à la moindre erreur

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'  # No Color

echo -e "${GREEN}─── Initialisation du déploiement BG Informatique ───${NC}"

# Vérifier qu'on est dans un dépôt git
if [ ! -d ".git" ]; then
  echo -e "${RED}Erreur : ce dossier n'est pas un dépôt git.${NC}"
  exit 1
fi

# Vérifier qu'on est sur la branche main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${YELLOW}Attention : vous êtes sur la branche '$CURRENT_BRANCH', pas 'main'.${NC}"
  read -p "Continuer quand même ? (o/N) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[OoYy]$ ]] && { echo "Annulé."; exit 0; }
fi

# Vérifier s'il y a quelque chose à committer
if git diff --quiet && git diff --staged --quiet; then
  echo -e "${YELLOW}Aucune modification à déployer. Sortie.${NC}"
  exit 0
fi

# Afficher les fichiers modifiés
echo -e "${BLUE}Fichiers modifiés :${NC}"
git status --short

# Ajout de toutes les modifications
git add .

# Message de commit : argument utilisateur ou horodatage
if [ $# -gt 0 ]; then
  COMMIT_MSG="$1"
else
  DATE=$(date +'%Y-%m-%d %H:%M:%S')
  COMMIT_MSG="Mise à jour BG Informatique - $DATE"
fi

echo -e "${BLUE}Commit : $COMMIT_MSG${NC}"
git commit -m "$COMMIT_MSG"

# Envoi vers GitHub
echo -e "${BLUE}Synchronisation avec le dépôt distant...${NC}"
git push origin "$CURRENT_BRANCH"

echo -e "${GREEN}─── Succès : déploiement terminé ! ───${NC}"
echo -e "${GREEN}Le site sera en ligne sur https://bginformatique.ca dans quelques instants.${NC}"
