#!/bin/sh
# Stellt den aktuellen Stand online: Quellcode nach main, Ordner app/ nach gh-pages (GitHub Pages).
set -e
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then echo "Es gibt nicht committete Änderungen – zuerst committen."; exit 1; fi
git push origin main
git push origin "$(git subtree split --prefix app main)":refs/heads/gh-pages
echo "Online in 1–2 Minuten: https://samuel-int.github.io/unihockey-trainingsplaner/"
