import { actionlint } from './actionlint';
import { eslint } from './eslint';
import { gitleaks } from './gitleaks';
import { golangciLint } from './golangci-lint';
import { govulncheck } from './govulncheck';
import { npmAudit } from './npm-audit';
import { osvScanner } from './osv-scanner';
import { oxlint } from './oxlint';
import { pipAudit } from './pip-audit';
import { ruff } from './ruff';
import { semgrep } from './semgrep';
import { trivyConfig, trivyLicense, trivyVuln } from './trivy';
import { zizmor } from './zizmor';
import type { Normalizer } from './util';

export type { NormalizeContext, Normalizer } from './util';
export { partialOf } from './util';

/** One normalizer per catalog tool (key = catalog name). Output that breaks the tool's `expect` contract throws `security-scan.parse`. */
export const NORMALIZERS: Record<string, Normalizer> = {
  gitleaks, semgrep, 'trivy-vuln': trivyVuln, 'trivy-config': trivyConfig, 'trivy-license': trivyLicense,
  'npm-audit': npmAudit, 'pip-audit': pipAudit, govulncheck, zizmor, actionlint, eslint, ruff, 'golangci-lint': golangciLint,
  // RM-072 (D13): as ferramentas do catalogo so do Agile (tools-agil.json), atras de flag.
  'osv-scanner': osvScanner, oxlint,
};
