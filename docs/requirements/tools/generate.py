"""Génère backlog.md et traceability.csv depuis stories.json (source unique). Usage : python3 docs/requirements/tools/generate.py"""
import csv, json, os
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
stories = json.load(open(os.path.join(here, "stories.json"), encoding="utf-8"))
reqs = sorted({s["req"] for s in stories})
p0 = sorted({s["req"] for s in stories if s["prio"] == "P0"})
with open(os.path.join(root, "traceability.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["requirement_id", "story_id", "screen", "entity", "endpoint_or_job", "test_path", "release", "status"])
    for s in stories:
        w.writerow([s["req"], s["id"], s["screen"], s["entity"], s["endpoint"], s["test"], s["prio"], s["status"]])
lines = [
    "# Backlog — matrice exigences / stories",
    "",
    "> GÉNÉRÉ depuis `tools/stories.json` (`python3 docs/requirements/tools/generate.py`). Ne pas éditer à la main.",
    "> Chaque story sera détaillée (périmètre, contrats, migrations, télémétrie, rollback) au démarrage de son lot (Definition of Ready, §14).",
    "",
    f"Exigences P0 : {len(p0)} — toutes reliées à au moins une story : **{'oui' if all(any(s['req']==r for s in stories) for r in p0) else 'NON'}**.",
    "",
    "| Exigence | Prio | Story | Lot | Rôle | Titre | Critère Given/When/Then (principal) | Statut |",
    "|---|---|---|---|---|---|---|---|",
]
for s in stories:
    lines.append(f"| {s['req']} | {s['prio']} | {s['id']} | {s['lot']} | {s['role']} | {s['title']} | {s['gwt']} | {s['status']} |")
lines += ["", "Statuts : NOT_STARTED, IN_PROGRESS, BLOCKED_EXTERNAL, READY_FOR_REVIEW, VERIFIED_LOCAL, VERIFIED_LIVE. « IN_PROGRESS » signifie qu'une partie (invariant SQL, simulateur) existe et est testée, pas que la story est livrée.", ""]
open(os.path.join(root, "backlog.md"), "w", encoding="utf-8").write("\n".join(lines))
print(f"{len(stories)} stories, {len(reqs)} exigences ({len(p0)} P0)")
