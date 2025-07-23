/**
 * COPIED FROM https://github.com/ex3ndr/handy/blob/main/sources/sync/claude-code-schema.ts
 * EDIT IN SYNC WITH ORIGINAL
 */

import { z } from "zod";

// Alright, bear with me here, because we are using constants, we have to define
// these types bottom up. Jump to the send to see the one schema to parse the
// entire claude code log file

// Usage statistics for assistant messages
export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative(),
  service_tier: z.string().optional(),
});

// Text content block
export const TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

// Thinking content block
export const ThinkingContentSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string(),
});

// Tool use content block
export const ToolUseContentSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(), // Tool-specific input parameters
});

// Tool result content block (in user messages)
export const ToolResultContentSchema = z.object({
  tool_use_id: z.string(),
  type: z.literal("tool_result"),
  content: z.union([
    z.string(), // For simple string responses
    z.array(TextContentSchema), // For structured content blocks (typically text)
  ]),
  is_error: z.boolean().optional(),
});

// Union of all content types
const ContentSchema = z.union([
  TextContentSchema,
  ThinkingContentSchema,
  ToolUseContentSchema,
  ToolResultContentSchema,
]);

// User message structure
export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.union([
    z.string(), // Simple string content
    z.array(z.union([ToolResultContentSchema, TextContentSchema])),
  ]),
});

// Assistant message structure
export const AssistantMessageSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string(),
  content: z.array(ContentSchema),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: UsageSchema,
});

// Base schema for conversation entries that need common fields
export const BaseEntrySchema = z.object({
  cwd: z.string(),
  sessionId: z.string(),
  version: z.string(),
  uuid: z.string(),
  timestamp: z.string().datetime(),
  parent_tool_use_id: z.string().nullable().optional(),
});

// Summary entry structure (different from base entries)
export const SummaryEntrySchema = z.object({
  type: z.literal("summary"),
  summary: z.string(),
  leafUuid: z.string(),
});

// User message entry schema
export const UserEntrySchema = BaseEntrySchema.extend({
  type: z.literal("user"),
  message: UserMessageSchema,
  isMeta: z.boolean().optional(),
  toolUseResult: z.unknown().optional(), // Present when user responds to tool use
});

// Assistant message entry schema
export const AssistantEntrySchema = BaseEntrySchema.extend({
  type: z.literal("assistant"),
  message: AssistantMessageSchema,
  requestId: z.string().optional(),
});

// System message entry schema
export const SystemEntrySchema = BaseEntrySchema.extend({
  type: z.literal("system"),
  content: z.string(),
  isMeta: z.boolean().optional(),
  level: z.string().optional(),
  parentUuid: z.string().optional(),
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
});

export const RawJSONLinesSchema = z.discriminatedUnion("type", [
  UserEntrySchema,
  AssistantEntrySchema,
  SummaryEntrySchema,
  SystemEntrySchema
]);

export type RawJSONLines = z.infer<typeof RawJSONLinesSchema>
