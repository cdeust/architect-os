// Les entrées inventées à la vérification (docs/design/orchestration-fable-5-2.md, §4 et §14) : le contrat de la sortie
// structurée d'une session neuve, la vérification de l'hôte et le scénario qu'il en écrit. Ni fichier ni processus.
// Ce qu'une session invente est une donnée : l'hôte l'écrit dans un gabarit fixe de Gherkin, ligne par ligne, et le
// donne à un exécuteur fixe que le fichier de l'étape nomme. Rien n'en atteint un shell.
import { z } from 'zod';
import { refusedPath } from './scout-facts.js';

// Les schémas et les expressions sont construits dans des fonctions : un littéral au niveau du module ferait rejouer
// toute la suite pour chacun de ses mutants (Stryker).

/**
 * Une ligne de Gherkin que l'hôte écrit : aucun caractère de contrôle (C0, DEL, C1), aucun séparateur de ligne ou de
 * paragraphe. Le gabarit seul fait la structure du fichier ; une valeur ne peut pas y commencer une ligne.
 */
function oneLine(): RegExp {
  return /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/;
}

/** Une ligne de texte libre d'une ligne : de 1 à `max` caractères. */
const line = (max: number) => z.string().min(1).max(max).regex(oneLine());

/**
 * Une ligne d'un bloc de texte d'un step : elle ne porte ni `"""` ni trois accents graves, les deux délimiteurs d'un
 * bloc en Gherkin, et ne peut donc pas le fermer ; ni `\"\"\"`, que Gherkin lit comme `"""` dans un bloc : la ligne que
 * l'exécuteur reçoit est celle que la session a écrite.
 */
const docLine = () =>
  z
    .string()
    .max(500)
    .regex(oneLine())
    .refine((text) => !['"""', '```', '\\"\\"\\"'].some((delimiter) => text.includes(delimiter)), {
      error: 'a doc string line holds a delimiter',
    });

/** Le plus d'entrées qu'une étape peut demander : `freshInputs.count` de `step.json` vaut de 1 à ce nombre. */
export function freshInputsMax(): number {
  return 16;
}

/**
 * La sortie structurée de la session qui invente : au plus 16 entrées, chacune ce qu'elle vise (`target`, un fichier du
 * worktree), l'entrée (`input` : le titre et les steps d'un scénario, écrits avec les steps qui existent déjà) et le
 * comportement attendu selon le brief (`expected`) ; et ce qu'elle n'a pas pu exprimer (`open`).
 */
export const freshInputsSchema = () =>
  z.strictObject({
    inputs: z
      .array(
        z.strictObject({
          target: line(300),
          input: z.strictObject({
            title: line(200),
            steps: z
              .array(
                z.strictObject({
                  keyword: z.enum(['Given', 'When', 'Then', 'And', 'But']),
                  text: line(500),
                  docString: z.array(docLine()).max(200).optional(),
                }),
              )
              .min(1)
              .max(30),
          }),
          expected: line(500),
        }),
      )
      .min(1)
      .max(freshInputsMax()),
    open: z.array(line(300)).max(10),
  });
export type FreshInputs = z.infer<ReturnType<typeof freshInputsSchema>>;
export type FreshInput = FreshInputs['inputs'][number];

/** Le schéma pour `--json-schema` : Claude Code 2.1.325 refuse le `$schema` 2020-12 (mesuré), comme pour le verdict. */
export const freshInputsJsonSchema = (): unknown =>
  z.toJSONSchema(freshInputsSchema(), { target: 'draft-07' });

/** L'identifiant qu'une entrée reçoit de l'hôte, par sa place (1 pour la première) : jamais un texte de la session. */
export const freshInputId = (index: number): string => `fresh-${index + 1}`;

/**
 * Les entrées que l'hôte reçoit, ou pourquoi il les refuse toutes. Refusé : ce que le schéma refuse, plus d'entrées que
 * `count`, et une cible que l'hôte ne lit pas (chemin refusé, comme une citation d'éclaireur, ou qui n'est pas un
 * fichier du worktree). `read` donne le texte d'un fichier du worktree ; il n'est pas appelé pour un chemin refusé.
 */
export function receiveFreshInputs(
  output: unknown,
  count: number,
  read: (path: string) => string | undefined,
): FreshInputs | string {
  const parsed = freshInputsSchema().safeParse(output);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  const { inputs } = parsed.data;
  if (inputs.length > count) return `${inputs.length} inputs, at most ${count} asked`;
  for (const [index, { target }] of inputs.entries()) {
    if (refusedPath(target) || read(target) === undefined)
      return `${freshInputId(index)}: the target is not a file of the worktree`;
  }
  return parsed.data;
}

/**
 * Le scénario d'une entrée, dans le gabarit fixe de l'hôte : le titre du fichier vient de l'hôte, chaque valeur de la
 * session tient sur sa ligne, après un mot-clé ou dans un bloc de texte qu'elle ne peut pas fermer.
 */
export function renderFreshScenario(step: string, id: string, input: FreshInput['input']): string {
  const lines = [`Feature: fresh input ${id} of the step ${step}`, '', `  Scenario: ${input.title}`];
  for (const { keyword, text, docString } of input.steps) {
    lines.push(`    ${keyword} ${text}`);
    if (docString !== undefined)
      lines.push('      """', ...docString.map((doc) => `      ${doc}`), '      """');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Le bloc ajouté au brief de la session qui invente : le nombre d'entrées demandé et l'empreinte de l'arbre dont le
 * changement part. Aucun texte d'une autre session.
 */
export function renderFreshRequest(count: number, commit: string): string {
  return [
    '## Fresh inputs the host asks for',
    '',
    `Invent at most ${count} inputs. The change is the working tree against the commit ${commit}: read it with \`git diff ${commit}\` and \`git status --short\`.`,
    '',
  ].join('\n');
}
