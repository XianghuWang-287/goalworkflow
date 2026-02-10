# Streaming LLM Responses Design

## Problem
`stream: false` in xaiClient causes 20-40s waits per LLM call. Users see no feedback during conversation Q&A and plan generation.

## Architecture (3 layers)
1. **xaiClient** — `chatCompletionStream()` AsyncGenerator yielding tokens
2. **API Routes** — SSE endpoints streaming tokens to browser
3. **Frontend** — `fetch` + `ReadableStream` consuming SSE events

## Layer 1: xaiClient
New method `chatCompletionStream()` returns `AsyncGenerator<string, string, undefined>`.
- Sets `stream: true` in API call
- Parses SSE `data: {...}` lines from response body
- Yields `delta.content` tokens
- Returns full concatenated text

## Layer 2: jsonGuard
New method `callAndValidateStream<T>()` with `onToken` callback.
- Calls `chatCompletionStream()`, forwards each token to `onToken`
- Collects full text, validates with Zod at end
- On validation failure, retries with non-streaming `callAndValidate()`

## Layer 3: API Routes — SSE Protocol

### Conversation API (`/api/goals/conversation`)
```
data: {"type":"token","content":"你"}
data: {"type":"done","message":"...","options":["A","B"]}
data: {"type":"complete","message":"...","goalSpec":{...},"classification":{...}}
data: {"type":"error","message":"Something went wrong"}
```

### Plan Generation API (`/api/goals/create`)
```
data: {"type":"status","message":"Generating plan..."}
data: {"type":"token","content":"{"}
data: {"type":"result","goalId":"...","plan":{...},"violations":[]}
data: {"type":"error","message":"..."}
```

## Layer 4: Frontend
- `ChatConversation`: stream tokens into a growing assistant message bubble
- `CreateGoalPage`: show streaming status during plan generation
- Both use `fetch` + `reader.read()` loop to parse SSE lines
- Shared `useSSE` hook or inline parsing

## Implementation Order
1. xaiClient.chatCompletionStream()
2. jsonGuard.callAndValidateStream()
3. Conversation API SSE
4. Plan generation API SSE
5. Frontend components
6. Test end-to-end
