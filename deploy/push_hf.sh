#!/bin/sh
# Push the current commit to a Hugging Face Docker Space.
#   HF_USER=<name> HF_TOKEN=<write token> [HF_SPACE=tenjicheck] sh deploy/push_hf.sh
# The Space needs a README with Space metadata, so a throwaway commit adds it on top of HEAD; the GitHub branch is
# not changed.
set -e
: "${HF_USER:?set HF_USER}" "${HF_TOKEN:?set HF_TOKEN}"
SPACE="${HF_SPACE:-tenjicheck}"
ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
git -C "$ROOT" worktree add -q --detach "$TMP" HEAD
{
  printf -- '---\ntitle: TenjiCheck\nemoji: 🦶\ncolorFrom: yellow\ncolorTo: gray\nsdk: docker\napp_port: 7860\npinned: false\nshort_description: Tactile paving inspection, planning and reporting\n---\n\n'
  cat "$TMP/README.md"
} > "$TMP/README.hf" && mv "$TMP/README.hf" "$TMP/README.md"
git -C "$TMP" add README.md
git -C "$TMP" -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Hugging Face Space metadata"
git -C "$TMP" push -f "https://$HF_USER:$HF_TOKEN@huggingface.co/spaces/$HF_USER/$SPACE" HEAD:main
git -C "$ROOT" worktree remove --force "$TMP"
echo "Pushed to https://huggingface.co/spaces/$HF_USER/$SPACE"
