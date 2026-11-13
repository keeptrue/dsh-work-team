/**
 * Output-schema enforcement for the Host fixtures.
 *
 * The kernel validates every tool result against the definition's `output.schema`
 * and throws `ToolOutputError` on a mismatch (`dsh-tools` `pipeline.js`), so a
 * receipt whose shape drifts never reaches the model. Before this helper, the
 * fixtures called the tool body directly and saw whatever object came back — a
 * missing required field passed every test and only failed in a live session.
 *
 * One implementation, two fixtures: `host.test.js` and `support/gate-host.js`
 * both register through `registerChecked`, so neither can quietly drop the check.
 */

import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';

/**
 * Register one tool, checking its return value against its declared schema.
 *
 * `defineTool` already converted the output spec into a JSON Schema node, so
 * `definition.output.schema` is exactly what the kernel validates against.
 * `execute()` is called with the same arguments the kernel passes, and a
 * violation throws a message naming the tool and every violation, which fails the
 * calling test instead of surfacing as a runtime error in the field.
 *
 * @param {Map<string, object>} into - registry to write the wrapper into.
 * @param {object} definition - tool definition from `defineTool`.
 * @returns {() => boolean} disposer.
 */
export function registerChecked(into, definition) {
  const schema = definition?.output?.schema;
  if (schema === undefined) {
    // Fixture stand-ins stand in for another package's tools (`send_message`,
    // `team_task_*`): they carry no definition of their own, so there is nothing
    // to validate against and nothing this helper could enforce.
    into.set(definition.name, definition);
    return () => into.delete(definition.name);
  }
  const checked = {
    ...definition,
    async execute(args, exec) {
      const value = await definition.execute(args, exec);
      const violations = validateJsonSchemaValue(schema, value, 'value');
      if (violations.length > 0) {
        throw new Error(
          `${definition.name} returned a value that does not match its output schema: ${violations.join('; ')}`,
        );
      }
      return value;
    },
  };
  into.set(definition.name, checked);
  return () => into.delete(definition.name);
}
