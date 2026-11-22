import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const model = 'gpt-6.2-astra';

// The host accepts only the challenge it generated. Provider IDs, metadata, reasoning
// and native tool declarations never cross the host/guest stream.
export function verifiedText(response, challenge, maxOutput) {
  const output = response?.output;
  if (
    response?.model !== model ||
    response.status !== 'completed' ||
    response.error != null ||
    response.incomplete_details != null ||
    (Object.hasOwn(response, 'end_turn') && response.end_turn !== true) ||
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
    item.status !== 'completed' ||
    (Object.hasOwn(item, 'phase') && item.phase !== 'final_answer') ||
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
  if (
    !Number.isSafeInteger(total) ||
    usage.total_tokens !== total ||
    !Number.isSafeInteger(maxOutput) ||
    usage.output_tokens > maxOutput
  ) {
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

export function textResponse(challenge, usage) {
  return {
    model,
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: challenge }],
      },
    ],
    usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens },
  };
}

// Both hosted and fixture routes consume the same, closed broker result.
// Native controls and provider-private fields must be resolved by the upstream host.
export function verifiedBrokerText(result, challenge, maxOutput) {
  const usage = verifiedText(result, challenge, maxOutput);
  if (!isDeepStrictEqual(result, textResponse(challenge, usage)))
    throw Error('SBX_SUBSCRIPTION_BROKER_SHAPE');
  return usage;
}

export const fixtureUsage = Object.freeze({ input_tokens: 8, output_tokens: 4, total_tokens: 12 });

export function fixtureResponse(challenge) {
  return textResponse(challenge, fixtureUsage);
}
