"""Verifica padrões de credenciais no histórico Git sem imprimir os valores."""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

FIXTURES = {
    "re_only_a_unit_test_value",
    "re_test_only_not_a_real_key",
    "re_test_only_deployment",
    "re_only_for_diagnostic_unit_tests",
    "unit-test-value-never-use-in-production-",
}
RULES = [
    ("resend-token", re.compile(r"\bre_[A-Za-z0-9_]{16,}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("github-fine-grained-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b")),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("secret-assignment", re.compile(
        r"""(?:RESEND_API_KEY|SECURITY_HMAC_KEY|CLOUDFLARE_API_TOKEN|GITHUB_TOKEN)["']?\s*[:=]\s*["']([A-Za-z0-9_+/=-]{20,})["']""",
        re.IGNORECASE,
    )),
]

def git(directory, *arguments):
    return subprocess.run(
        ["git", "-C", directory, *arguments],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    ).stdout

def scan(directory):
    commits = git(directory, "rev-list", "--all").decode().splitlines()
    blobs = {}
    for commit in commits:
        for row in git(directory, "ls-tree", "-r", "-z", commit).split(b"\x00"):
            if not row:
                continue
            metadata, pathname = row.split(b"\t", 1)
            _mode, kind, sha = metadata.decode().split()
            if kind == "blob":
                blobs.setdefault(sha, (commit, pathname.decode("utf-8", "replace")))
    findings = []
    checked = 0
    for sha, (commit, pathname) in blobs.items():
        raw = git(directory, "cat-file", "blob", sha)
        if b"\x00" in raw:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        checked += 1
        for label, pattern in RULES:
            for match in pattern.finditer(text):
                value = match.group(1) if match.lastindex else match.group()
                if value in FIXTURES:
                    continue
                findings.append({"rule": label, "path": pathname, "commit": commit})
                break
    return {
        "passed": not findings,
        "commits_checked": len(commits),
        "unique_text_blobs_checked": checked,
        "findings": findings,
        "secret_values_printed": False,
        "scope": "Padrões conhecidos no histórico alcançável; não é garantia de ausência de todos os segredos.",
    }

def report(state, description):
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    sha = os.environ.get("GITHUB_SHA", "")
    run = os.environ.get("GITHUB_RUN_ID", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    if (os.environ.get("GITHUB_REPOSITORY_ID") != "1452563434"
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
        or not re.fullmatch(r"[a-f0-9]{40}", sha)
        or not re.fullmatch(r"\d+", run) or not token):
        raise ValueError("Contexto de auditoria inválido.")
    body = json.dumps({
        "state": state, "description": description,
        "context": "time-saver/secret-audit",
        "target_url": "https://github.com/" + repository + "/actions/runs/" + run,
    }).encode()
    request = urllib.request.Request(
        "https://api.github.com/repos/" + repository + "/statuses/" + sha,
        data=body, method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        if response.status != 201:
            raise ValueError("Resultado não registado.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", default=os.getcwd())
    parser.add_argument("--github-status", action="store_true")
    args = parser.parse_args()
    try:
        if args.github_status:
            report("pending", "A verificar padrões de segredos no histórico Git completo.")
        result = scan(args.repository)
        print(json.dumps(result, ensure_ascii=False))
        if args.github_status:
            report("success" if result["passed"] else "failure",
                   "Sem padrões de segredos detetados no histórico verificado."
                   if result["passed"] else "Possíveis segredos no histórico; publicação bloqueada.")
        return 0 if result["passed"] else 1
    except Exception:
        print(json.dumps({"passed": False, "message": "Auditoria não concluída. Nenhum valor de segredo foi apresentado."}))
        if args.github_status:
            try:
                report("failure", "Auditoria não concluída; publicação bloqueada.")
            except Exception:
                pass
        return 2

if __name__ == "__main__":
    sys.exit(main())
