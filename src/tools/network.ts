/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type NetworkExportPart,
  exportNetworkRequestPart,
} from '../formatters/networkFormatter.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

// Resource types as string literals (Playwright returns string from resourceType())
const FILTERABLE_RESOURCE_TYPES = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'websocket',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'other',
] as const;

const NETWORK_EXPORT_PARTS = [
  'all',
  'responseHeaders',
  'responseBody',
  'requestBody',
  'queryParams',
] as const;

export const listNetworkRequests = defineTool({
  name: 'list_network_requests',
  description: `List network requests for the currently selected page since the last navigation. Results are sorted newest-first and include request start time plus duration. By default returns the 20 most recent requests; use pageSize/pageIdx to paginate. List output is an index: it shows status, summarized long URLs, and Set-Cookie names, not header/body contents. Pass reqid to inspect one request with timing, bounded inline headers where sensitive values such as Cookie, Authorization, and token-like headers are redacted, content-type-aware body previews, and a dedicated Set-Cookie section that shows raw values up to 1KB total. When exact bytes, full bodies, replay inputs, signature inputs, large request bodies, long GET query payloads, binary responses, full headers, full Set-Cookie values, or data for external decoding are needed, pass reqid with outputFile to export the selected data. For GET requests, payload-like data means parsed URL query parameters.`,
  annotations: {
    category: ToolCategory.NETWORK,
    // Not read-only due to outputFile export support.
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .optional()
      .describe(
        'The reqid of a specific network request to get full details for. If omitted, lists all requests.',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of requests to return. Defaults to 20.'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Page number to return (0-based). When omitted, returns the first page.',
      ),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe(
        'Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        'Filter requests by URL. Only requests containing this substring will be returned.',
      ),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to return the preserved requests over the last 3 navigations.',
      ),
    outputFile: zod
      .string()
      .optional()
      .describe(
        'When reqid is provided, save network data to this local file instead of returning only inline text. Use this for exact bytes, large bodies, long GET query payloads, binary responses, replay/signature inputs, or data that will be decoded with external tools. Absolute paths and paths relative to the current working directory are supported. The response reports the resolved absolute path; use that path with evaluate_script localFilePath when browser-side processing is needed.',
      ),
    outputPart: zod
      .enum(NETWORK_EXPORT_PARTS)
      .default('all')
      .optional()
      .describe(
        'Which part to export when outputFile is provided. "responseHeaders" saves response headers as JSON while preserving repeated headers such as Set-Cookie, "responseBody" saves raw response bytes, "requestBody" saves captured request body bytes, "queryParams" saves parsed URL query parameters as JSON, and "all" saves a JSON bundle with metadata, headers, query params, and body content/metadata. Defaults to "all".',
      ),
  },
  handler: async (request, response, context) => {
    if (request.params.outputFile && request.params.reqid === undefined) {
      response.appendResponseLine(
        'outputFile requires reqid. First call list_network_requests without outputFile to find the request id, then re-run with reqid and outputFile.',
      );
      return;
    }

    if (request.params.reqid !== undefined) {
      if (request.params.outputFile) {
        const networkRequest = context.getNetworkRequestById(
          request.params.reqid,
        );
        const outputPart = request.params.outputPart as NetworkExportPart;
        const exported = await exportNetworkRequestPart(
          networkRequest,
          outputPart,
        );
        const file = await context.saveFile(
          exported.data,
          request.params.outputFile,
        );
        response.appendResponseLine(
          `${exported.summary} Saved ${outputPart} to ${file.filename}.`,
        );
        return;
      }

      response.attachNetworkRequest(request.params.reqid);
      return;
    }
    const data = await context.getDevToolsData();
    const reqid = data?.cdpRequestId
      ? context.resolveCdpRequestId(data.cdpRequestId)
      : undefined;
    response.setIncludeNetworkRequests(true, {
      pageSize: request.params.pageSize,
      pageIdx: request.params.pageIdx,
      resourceTypes: request.params.resourceTypes,
      urlFilter: request.params.urlFilter,
      includePreservedRequests: request.params.includePreservedRequests,
      networkRequestIdInDevToolsUI: reqid,
    });
  },
});

export const replaceResponse = defineTool({
  name: 'replace_response',
  description:
    'Install a response replacement rule for the selected page. Matching requests are fulfilled with the provided body/bodyFile, status, contentType, and headers. Use this to swap a restored JavaScript chunk into a live site while keeping the browser debugging workflow intact.',
  annotations: {
    title: 'Replace Response',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    urlPattern: zod
      .string()
      .describe(
        'URL substring, glob, or regex pattern to match. Plain strings use contains semantics; patterns with * use glob semantics; set regex=true for regular expressions.',
      ),
    regex: zod
      .boolean()
      .default(false)
      .optional()
      .describe('Treat urlPattern as a JavaScript regular expression.'),
    body: zod
      .string()
      .optional()
      .describe('Inline replacement body. Prefer bodyFile for large scripts.'),
    bodyFile: zod
      .string()
      .optional()
      .describe(
        'Read replacement body from this local file. Absolute paths and paths relative to the MCP process working directory are supported.',
      ),
    status: zod
      .number()
      .int()
      .min(100)
      .max(599)
      .default(200)
      .optional()
      .describe('HTTP status for the fulfilled response. Defaults to 200.'),
    contentType: zod
      .string()
      .optional()
      .describe(
        'Content-Type for the fulfilled response, for example application/javascript; charset=utf-8.',
      ),
    headers: zod
      .record(zod.string(), zod.string())
      .default({})
      .optional()
      .describe('Additional response headers to include.'),
    resourceTypes: zod
      .array(zod.string())
      .default([])
      .optional()
      .describe(
        'Optional Playwright resourceType filter, for example ["script"]. Empty means all resource types.',
      ),
    once: zod
      .boolean()
      .default(false)
      .optional()
      .describe('Disable this replacement after the first hit.'),
  },
  handler: async (request, response, context) => {
    const {body, bodyFile} = request.params;
    if ((body === undefined && bodyFile === undefined) || (body && bodyFile)) {
      response.appendResponseLine(
        'Provide exactly one of body or bodyFile for replace_response.',
      );
      return;
    }

    const replacementBody =
      bodyFile !== undefined
        ? await fs.readFile(path.resolve(bodyFile), 'utf8')
        : body!;
    const replacement = await context.addResponseReplacement({
      urlPattern: request.params.urlPattern,
      regex: request.params.regex,
      body: replacementBody,
      status: request.params.status,
      contentType: request.params.contentType,
      headers: request.params.headers,
      resourceTypes: request.params.resourceTypes,
      once: request.params.once,
    });

    response.appendResponseLine(
      `Installed response replacement #${replacement.id} for ${replacement.urlPattern}. Body length: ${replacement.body.length} bytes.`,
    );
  },
});

export const listResponseReplacements = defineTool({
  name: 'list_response_replacements',
  description:
    'List active and inactive response replacement rules, including hit counts.',
  annotations: {
    title: 'List Response Replacements',
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const replacements = context.listResponseReplacements();
    if (!replacements.length) {
      response.appendResponseLine('No response replacements installed.');
      return;
    }
    for (const replacement of replacements) {
      response.appendResponseLine(
        `#${replacement.id} ${replacement.active ? 'active' : 'inactive'} hits=${replacement.hitCount} pattern=${replacement.urlPattern} status=${replacement.status ?? 200} contentType=${replacement.contentType ?? '(default)'}`,
      );
    }
  },
});

export const clearResponseReplacements = defineTool({
  name: 'clear_response_replacements',
  description:
    'Clear response replacement rules by id, by exact urlPattern, or all rules. If no selector is provided, clears all rules.',
  annotations: {
    title: 'Clear Response Replacements',
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    id: zod.number().int().positive().optional().describe('Replacement id.'),
    urlPattern: zod
      .string()
      .optional()
      .describe('Exact urlPattern to clear.'),
    all: zod
      .boolean()
      .default(false)
      .optional()
      .describe('Clear all replacement rules.'),
  },
  handler: async (request, response, context) => {
    const removed = await context.clearResponseReplacements({
      id: request.params.id,
      urlPattern: request.params.urlPattern,
      all: request.params.all,
    });
    response.appendResponseLine(
      removed.length
        ? `Cleared ${removed.length} response replacement(s): ${removed.map(item => `#${item.id}`).join(', ')}.`
        : 'No matching response replacements found.',
    );
  },
});
