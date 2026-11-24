# The `check` step of family-calendar's zizd pipeline: the .dev diagrams and knowledge files (what the `diagrams` job of
# .github/workflows/ci.yml checks). Reads the repository at /zazzle/input/repos/OWNER/family-calendar; writes nothing.
FROM python:3.13.9-slim
RUN pip install --no-cache-dir jsonschema==4.26.0
COPY run.sh /run.sh
CMD ["sh", "/run.sh"]
