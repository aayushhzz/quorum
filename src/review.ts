// Deterministic review of a unified diff. Pure: no Cloudflare imports, so tests run in node.
// It reports where to look and never echoes a matched secret value.

export interface Finding {
  severity: "high" | "medium" | "low";
  message: string;
}

const SECRET_ASSIGN =
  /\b(api[_-]?key|key|secret|token|passcode|password)\b\s*[:=]\s*["'`][^"'`\s]{6,}/i;
const SECRET_TOKEN =
  /gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Added lines of a unified diff, with the file they belong to. */
export function addedLines(diff: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ "))
      file = line.slice(4).replace(/^b\//, "").trim();
    else if (line.startsWith("+") && !line.startsWith("+++"))
      out.push({ file, text: line.slice(1) });
  }
  return out;
}

export function changedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (m && m[1] !== "/dev/null") files.add(m[1].trim());
  }
  return [...files];
}

export function reviewDiff(diff: string): Finding[] {
  if (!diff.trim())
    return [{ severity: "low", message: "No diff was provided." }];
  const findings: Finding[] = [];
  const added = addedLines(diff);

  for (const { file, text } of added) {
    const where = file || "unknown file";
    if (SECRET_TOKEN.test(text) || SECRET_ASSIGN.test(text))
      findings.push({
        severity: "high",
        message: `Possible secret added in ${where}. Remove it and rotate the value.`
      });
    if (/\beval\s*\(/.test(text) || /new Function\s*\(/.test(text))
      findings.push({
        severity: "high",
        message: `eval or new Function in ${where}; code from input can run here.`
      });
    if (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(text))
      findings.push({
        severity: "medium",
        message: `Raw HTML rendering in ${where}; check the input is escaped.`
      });
    if (/console\.log\(/.test(text))
      findings.push({
        severity: "low",
        message: `console.log left in ${where}.`
      });
    if (/:\s*any\b/.test(text))
      findings.push({
        severity: "low",
        message: `'any' type used in ${where}; prefer a real type.`
      });
    if (/\b(TODO|FIXME)\b/.test(text))
      findings.push({
        severity: "low",
        message: `TODO or FIXME added in ${where}.`
      });
  }

  const files = changedFiles(diff);
  const touchesCode = files.some(
    (f) => /^src\//.test(f) && /\.(ts|tsx)$/.test(f)
  );
  const touchesTests = files.some((f) => /^test\//.test(f));
  if (touchesCode && !touchesTests)
    findings.push({
      severity: "medium",
      message:
        "Source changed but no test file changed. Add a test for the new behaviour."
    });
  if (added.length > 400)
    findings.push({
      severity: "low",
      message: `Large change (${added.length} added lines). Consider splitting it.`
    });

  return findings;
}

export function formatFindings(findings: Finding[]): string {
  if (!findings.length)
    return "No findings from the automatic checks. Still read the change for logic errors.";
  const order = { high: 0, medium: 1, low: 2 };
  return [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((f) => `[${f.severity}] ${f.message}`)
    .join("\n");
}
