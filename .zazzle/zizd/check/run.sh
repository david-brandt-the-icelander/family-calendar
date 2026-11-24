# Validate the .dev diagrams and knowledge files. The validators only read, so they run on the read-only checkout.
set -eu
export HOME=/tmp PYTHONDONTWRITEBYTECODE=1
src=$(ls -d /zazzle/input/repos/*/family-calendar | head -1)
cd "$src"
python3 Meta/Agents/Skills/validate_diagrams.py
python3 Meta/Agents/Knowledge/validate_knowledge.py
echo "family-calendar: diagrams and knowledge files valid"
