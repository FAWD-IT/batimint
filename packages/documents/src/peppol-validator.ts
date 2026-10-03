/**
 * Validation des UBL émis par les règles officielles EN 16931 + Peppol (schematron, XPath 2) en
 * JavaScript pur. Utilisé par les tests (05 §1 : « valider aussi le XML produit avec les règles
 * EN 16931 / Peppol dans les tests ») ; les fonctions XSLT utilitaires du schematron Peppol sont
 * réimplémentées ici.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCustomXPathFunction, Schema } from 'node-schematron';

const U = 'utils';
let registered = false;

function digits(v: unknown): string | null {
  const s = v === null || v === undefined ? null : String(v);
  return s && /^\d+$/.test(s) ? s : null;
}

function registerFunctions(): void {
  if (registered) return;
  registered = true;
  const any = 'xs:anyAtomicType?';
  registerCustomXPathFunction(
    { namespaceURI: U, localName: 'gln' },
    [any],
    'xs:boolean',
    (_c, v: unknown) => {
      const s = digits(v);
      if (!s) return false;
      const body = s.slice(0, -1).split('').reverse().map(Number);
      const sum = body.reduce((acc, d, i) => acc + d * (1 + ((i + 1) % 2) * 2), 0);
      return (10 - (sum % 10)) % 10 === Number(s.slice(-1));
    },
  );
  registerCustomXPathFunction(
    { namespaceURI: U, localName: 'slack' },
    [any, any, any],
    'xs:boolean',
    (_c, exp: unknown, val: unknown, slack: unknown) =>
      Number(exp) + Number(slack) >= Number(val) && Number(exp) - Number(slack) <= Number(val),
  );
  registerCustomXPathFunction(
    { namespaceURI: U, localName: 'mod11' },
    [any],
    'xs:boolean',
    (_c, v: unknown) => {
      const s = digits(v);
      if (!s) return false;
      const body = s.slice(0, -1).split('').reverse().map(Number);
      const sum = body.reduce((acc, d, i) => acc + d * ((i % 6) + 2), 0);
      return Number(s) > 0 && (11 - (sum % 11)) % 11 === Number(s.slice(-1));
    },
  );
  registerCustomXPathFunction(
    { namespaceURI: U, localName: 'mod97-0208' },
    [any],
    'xs:boolean',
    (_c, v: unknown) => {
      const s = digits(v);
      return Boolean(s && s.length === 10 && 97 - (Number(s.slice(0, 8)) % 97) === Number(s.slice(8)));
    },
  );
  // Contrôles nationaux hors Belgique (Italie, Australie, Grèce, Suède) : sans objet pour nos documents.
  for (const name of [
    'checkCodiceIPA',
    'checkCF',
    'checkCF16',
    'checkPIVAseIT',
    'abn',
    'TinVerification',
    'checkSEOrgnr',
  ])
    registerCustomXPathFunction({ namespaceURI: U, localName: name }, [any], 'xs:boolean', () => true);
}

let schemas: Schema[] | null = null;
/** Gravité de chaque règle (`fatal` ou `warning`), lue dans les fichiers schematron. */
const flags = new Map<string, string>();

function loadSchemas(): Schema[] {
  if (schemas) return schemas;
  registerFunctions();
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test/peppol-rules');
  schemas = ['CEN-EN16931-UBL.sch', 'PEPPOL-EN16931-UBL.sch'].map((f) => {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const tag of text.match(/<assert\b[^>]*>/g) ?? []) {
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      if (id) flags.set(id, /\bflag="([^"]+)"/.exec(tag)?.[1] ?? 'fatal');
    }
    return Schema.fromString(text);
  });
  return schemas;
}

export interface RuleViolation {
  id: string;
  flag: string;
  message: string;
}

/** Erreurs (fatal) et avertissements des règles EN 16931 et Peppol pour un document UBL. */
export function validatePeppolUbl(xml: string): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const schema of loadSchemas())
    for (const r of schema.validateString(xml))
      if (!r.isReport)
        out.push({
          id: r.assertId ?? '',
          flag: flags.get(r.assertId ?? '') ?? 'fatal',
          message: (r.message ?? '').replace(/\s+/g, ' ').trim(),
        });
  return out;
}
