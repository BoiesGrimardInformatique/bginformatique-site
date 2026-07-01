#!/bin/bash
# ==========================================================
#  Script de déploiement - BG Informatique
#  Usage : ./deploy.sh ["message de commit optionnel"]
#
#  Un déploiement équivaut TOUJOURS à un merge sur `main` :
#  quelle que soit la branche de travail, le script committe les
#  modifications locales, fusionne cette branche dans `main`, puis
#  pousse `main` (c'est `main` qui est publié en ligne).
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

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Message de commit : argument utilisateur ou horodatage
if [ $# -gt 0 ]; then
  COMMIT_MSG="$1"
else
  DATE=$(date +'%Y-%m-%d %H:%M:%S')
  COMMIT_MSG="Mise à jour BG Informatique - $DATE"
fi

# 1) Committer les modifications locales (s'il y en a)
if git diff --quiet && git diff --staged --quiet; then
  echo -e "${YELLOW}Aucune modification locale à committer.${NC}"
else
  echo -e "${BLUE}Fichiers modifiés :${NC}"
  git status --short
  git add .
  echo -e "${BLUE}Commit : $COMMIT_MSG${NC}"
  git commit -m "$COMMIT_MSG"
fi

# 2) Publier sur `main` (déploiement = merge sur main)
echo -e "${BLUE}Publication sur main...${NC}"
git fetch origin main

if [ "$CURRENT_BRANCH" = "main" ]; then
  # Déjà sur main : s'aligner sur origin/main puis pousser
  git merge --ff-only origin/main || {
    echo -e "${RED}Erreur : 'main' local a divergé de origin/main. Résolvez le conflit manuellement.${NC}"
    exit 1
  }
  git push origin main
else
  # Sur une branche de travail : fusionner dans main puis pousser main
  git checkout main
  git merge --ff-only origin/main || {
    echo -e "${RED}Erreur : 'main' local a divergé de origin/main. Résolvez le conflit manuellement.${NC}"
    git checkout "$CURRENT_BRANCH"
    exit 1
  }

  if git merge --ff-only "$CURRENT_BRANCH"; then
    echo -e "${GREEN}Fast-forward de main.${NC}"
  else
    git merge --no-ff "$CURRENT_BRANCH" -m "Déploiement : fusion de $CURRENT_BRANCH dans main"
  fi

  git push origin main

  # Revenir sur la branche de travail et la synchroniser
  git checkout "$CURRENT_BRANCH"
  git push origin "$CURRENT_BRANCH"
fi

echo -e "${GREEN}─── Succès : déploiement terminé ! ───${NC}"
echo -e "${GREEN}Le site sera en ligne sur https://bginformatique.ca dans quelques instants.${NC}"
