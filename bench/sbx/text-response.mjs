import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const model = 'gpt-6.2-astra';

// The challenge is a fresh host-generated nonce. Its digest binds the private worker
// result to the same turn without retaining the text in the subscription receipt.
export function challengeDigest(challenge) {
  return createHash('sha256').update(challenge, 'utf8').digest('hex');
}

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

function checkPresentation(presentation) {
  if (presentation !== undefined && presentation !== 'inline') throw Error('SBX_SUBSCRIPTION_BROKER_SHAPE');
}

export function nativeTextStream(text, usage, presentation) {
  checkPresentation(presentation);
  const response = { id: 'resp_' + randomUUID(), model, object: 'response' };
  const item = {
    id: 'msg_' + randomUUID(),
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const events = [{ type: 'response.created', response: { ...response, status: 'in_progress' } }];
  if (presentation === 'inline') {
    // Codex emits this presentation-only notification for the current turn.
    // https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/tests/suite/v2/safety_check_downgrade.rs#L278-L339
    events.push({
      type: 'response.metadata',
      response_id: response.id,
      metadata: { openai_chatgpt_moderation_metadata: { presentation: 'inline' } },
    });
  }
  events.push(
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
  );
  return events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
}

export function textResponse(challenge, usage, presentation, reasoningIncluded) {
  checkPresentation(presentation);
  if (reasoningIncluded !== undefined && reasoningIncluded !== true)
    throw Error('SBX_SUBSCRIPTION_BROKER_SHAPE');
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
    ...(presentation === 'inline' ? { moderation_presentation: 'inline' } : {}),
    ...(reasoningIncluded === true ? { reasoning_included: true } : {}),
  };
}

// Both hosted and fixture routes consume the same, closed broker result.
// Only the fixed presentation and HTTP presence flag can accompany the verified text and usage.
export function verifiedBrokerText(result, challenge, maxOutput) {
  const usage = verifiedText(result, challenge, maxOutput);
  if (
    !isDeepStrictEqual(
      result,
      textResponse(challenge, usage, result.moderation_presentation, result.reasoning_included),
    )
  )
    throw Error('SBX_SUBSCRIPTION_BROKER_SHAPE');
  return usage;
}

export const fixtureUsage = Object.freeze({ input_tokens: 8, output_tokens: 4, total_tokens: 12 });

export function fixtureResponse(challenge) {
  return textResponse(challenge, fixtureUsage);
}
