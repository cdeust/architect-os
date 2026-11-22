import { randomUUID } from 'node:crypto';

export const model = 'gpt-6.2-astra';

// The host accepts only the challenge it generated. Provider IDs, metadata, reasoning
// and native tool declarations never cross the host/guest stream.
export function verifiedText(response, challenge) {
  const output = response?.output;
  if (
    response?.model !== model ||
    response.status !== 'completed' ||
    response.error != null ||
    !Array.isArray(output)
  )
    throw Error('SBX_SUBSCRIPTION_TEXT_MISMATCH');
  // A reasoning model may emit private reasoning metadata before the single final message.
  // Discard that item at the host. No other item type can initiate a native action.
  const hasReasoning = output.length === 2 && output[0]?.type === 'reasoning';
  if (output.length !== 1 && !hasReasoning) throw Error('SBX_SUBSCRIPTION_TEXT_MISMATCH');
  const item = output.at(-1);
  const part = item?.content?.[0];
  if (
    item?.type !== 'message' ||
    item.role !== 'assistant' ||
    (item.status !== undefined && item.status !== 'completed') ||
    !Array.isArray(item.content) ||
    item.content.length !== 1 ||
    part?.type !== 'output_text' ||
    part.text !== challenge
  )
    throw Error('SBX_SUBSCRIPTION_TEXT_MISMATCH');
  const usage = response.usage;
  if (![usage?.input_tokens, usage?.output_tokens].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw Error('SBX_SUBSCRIPTION_USAGE_MISSING');
  }
  const total = usage.input_tokens + usage.output_tokens;
  if (!Number.isSafeInteger(total) || (usage.total_tokens !== undefined && usage.total_tokens !== total)) {
    throw Error('SBX_SUBSCRIPTION_USAGE_MISMATCH');
  }
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

export function nativeTextStream(text, usage) {
  const response = { id: 'resp_' + randomUUID(), model, object: 'response' };
  const item = {
    id: 'msg_' + randomUUID(),
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        ...response,
        status: 'completed',
        output: [item],
        usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
      },
    },
  ];
  return events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
}

export function fixtureResponse(challenge) {
  // Deliberately synthetic counters; the receipt labels this source explicitly.
  return {
    model,
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: challenge }] }],
    usage: { input_tokens: 8, output_tokens: 4 },
  };
}
