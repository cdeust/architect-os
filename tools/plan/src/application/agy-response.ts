export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
}

export function readAgyTurn(text: string, model: string) {
  const lines = text.trimEnd().split('\n');
  const events = lines.map((line) => record(JSON.parse(line)));
  const initEvent = events[0];
  const terminal = events.at(-1);
  if (initEvent?.event !== 'init' || terminal?.event !== 'result') throw new Error('incomplete stream');
  const init = record(initEvent.init);
  const id = initEvent.conversation_id;
  const result = record(terminal.result);
  if (
    typeof id !== 'string' ||
    !id ||
    init.model !== model ||
    init.permission_mode !== 'strict' ||
    result.conversation_id !== id ||
    result.num_turns !== 1
  )
    throw new Error('unexpected invocation');
  for (const event of events.slice(1, -1)) {
    if (event.event !== 'step_update') throw new Error('unexpected stream event');
    const update = record(event.step_update);
    if (
      update.conversation_id !== id ||
      'tool_name' in update ||
      'tool_info' in update ||
      'subagent_info' in update ||
      (update.state !== 'ACTIVE' && update.state !== 'DONE') ||
      (update.step_type !== 'user_input' &&
        update.step_type !== 'agent_response' &&
        update.step_type !== 'checkpoint')
    )
      throw new Error('unexpected step');
  }
  return result;
}
